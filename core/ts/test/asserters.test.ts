import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Atom, Clause, Derivation, RuleNode, Term, type Value } from "@bitspark/logos-contract";
import { encodeInt } from "@bitspark/ontos-data";
import {
  atom, authorization, attributedClause, createSpacesVerifier, decodeProof, decodeSpaceFacts,
  encodeProof, encodeSpaceFacts, fact, lawDigest, path, type Proof, type SpaceFacts,
} from "../src/index.js";
import { ProofBuilder } from "../test/recipes.js";
import { inputLiteral } from "../src/encoding.js";
import { authenticateExampleFacts, signExampleFacts, signExamplePayload } from "./fixtures/authentication.js";
import { confer, documentProof, EXAMPLE_TIME, releaseProof, ROOT, rootAuthority, SUPPLY_FACTS } from "./fixtures/proofs.js";

const verifier = createSpacesVerifier({ root: ROOT, authenticate: authenticateExampleFacts });
function replaceBundle(proof: Proof, index: number, edit: (output: SpaceFacts) => SpaceFacts, resign = false): Proof {
  const bundles = [...proof.bundles], original = bundles[index]!;
  const output = edit(decodeSpaceFacts(original.payload));
  bundles[index] = resign ? signExampleFacts(output) : { ...original, payload: encodeSpaceFacts(output) };
  return { ...proof, bundles };
}
function replacePremises(proof: Proof, index: number, edit: (refs: number[]) => void): Proof {
  const nodes = [...proof.derivation.nodes], node = nodes[index];
  assert.ok(node instanceof RuleNode);
  const refs = [...node.premises] as number[];
  edit(refs);
  nodes[index] = new RuleNode(node.conclusion, node.clause, node.subst, refs);
  return { ...proof, derivation: new Derivation(nodes, proof.derivation.root) };
}

test("the frozen core digest is unchanged by the asserter layer", () => {
  assert.equal(Buffer.from(lawDigest.bytes()).toString("hex"), "80f91df84e8597daf04bebc8643bc8884086829b0d06795d1e0ee97be379fe7d");
});
test("one offline document proof contains root, parent and child asserter outputs", () => {
  const example = documentProof(), proof = decodeProof(example.proof);
  const outputs = proof.bundles.map(b => decodeSpaceFacts(b.payload));
  assert.equal(outputs.length, 3);
  for (const [index, identity] of [ROOT, atom("team_asserter"), atom("docs_asserter")].entries()) {
    assert.ok(outputs[index]!.supplier.equals(identity));
    assert.ok(authenticateExampleFacts({ ...proof.bundles[index]!, supplier: identity }));
  }
  assert.ok(Term.eraseGround(outputs[2]!.clauses[0]!.head.args[0]!)!.equals(atom("alice")));
  assert.equal(verifier.verify(example).permitted, true);
});
for (const field of ["supplier", "space", "assertedAt", "clauses"] as const) {
  test("authentication binds the bundle's " + field, () => {
    const example = documentProof();
    const edited = replaceBundle(decodeProof(example.proof), example.docsBundle, output => {
      if (field === "supplier") return { ...output, supplier: atom("another") };
      if (field === "space") return { ...output, space: path("elsewhere") };
      if (field === "assertedAt") return { ...output, assertedAt: encodeInt(0n) };
      return { ...output, clauses: [attributedClause(ROOT, output.space, fact("invented"))] };
    });
    assert.equal(verifier.verify({ query: example.query, proof: encodeProof(edited) }).code, "authentication-failed");
  });
}
test("authentication binds the complete variable-rule body", () => {
  const example = releaseProof();
  const edited = replaceBundle(decodeProof(example.proof), example.policyIndex,
    output => ({ ...output, clauses: [Clause.fact(output.clauses[0]!.head)] }));
  assert.equal(verifier.verify({ query: example.query, proof: encodeProof(edited) }).code, "authentication-failed");
});
test("a signature by another supplier and a corrupted signature are rejected", () => {
  const example = documentProof(), proof = decodeProof(example.proof), bundles = [...proof.bundles];
  const original = bundles[example.docsBundle]!;
  for (const bad of [signExamplePayload(atom("other"), original.payload),
    { ...original, authentication: new Atom(new Uint8Array(64)) }]) {
    bundles[example.docsBundle] = bad;
    assert.equal(verifier.verify({ query: example.query, proof: encodeProof({ ...proof, bundles }) }).permitted, false);
  }
});
test("even authenticated root output must use its declared exact placement", () => {
  const example = documentProof();
  const edited = replaceBundle(decodeProof(example.proof), example.rootBundle,
    output => ({ ...output, space: path("team") }), true);
  const result = verifier.verify({ query: example.query, proof: encodeProof(edited) });
  assert.equal(result.permitted, false);
  assert.match(result.detail!, /placement/);
});
test("a valid signature does not replace a supplier's authority proof", () => {
  const example = documentProof();
  for (const edit of [(refs: number[]) => { refs.pop(); }, (refs: number[]) => { refs[1] = refs[0]!; }]) {
    const proof = replacePremises(decodeProof(example.proof), example.bobCount, edit);
    assert.equal(verifier.verify({ query: example.query, proof: encodeProof(proof) }).permitted, false);
  }
});
test("a supplier's authority does not replace the original author's authority", () => {
  const example = documentProof();
  const proof = replacePremises(decodeProof(example.proof), example.bobCount, refs => { refs[0] = refs[1]!; });
  assert.equal(verifier.verify({ query: example.query, proof: encodeProof(proof) }).permitted, false);
});
test("an unsupported supplier cannot establish its own authority through its output", () => {
  const p = new ProofBuilder(), supplier = atom("unsupported"), space = path();
  const grant = authorization(supplier, SUPPLY_FACTS, space);
  const bundle = p.bundle(signExampleFacts({ supplier, space, assertedAt: EXAMPLE_TIME,
    clauses: [attributedClause(ROOT, space, grant)] }));
  const authorRight = rootAuthority(p, p.anchor(ROOT), grant, space);
  const unsupported = p.premise(grant);
  const counted = p.assert(bundle, 0, {}, [authorRight, unsupported]);
  const permission = confer(p, counted, ROOT, space, supplier, SUPPLY_FACTS, space);
  const query = { actor: supplier, statement: SUPPLY_FACTS, space };
  assert.equal(verifier.verify({ query, proof: p.finish(permission) }).permitted, false);
  // Close the attempted support cycle instead of supplying the rejected leaf.
  p.nodes[unsupported] = p.nodes[permission]!;
  assert.equal(verifier.verify({ query, proof: p.finish(permission) }).permitted, false);
});
test("ancestor supply authority is retained and works directly in descendants", () => {
  const example = documentProof(), original = decodeProof(example.proof);
  const nodes = original.derivation.nodes;
  const parentAtChild = nodes.findIndex(n => n.conclusion.equals(
    inputLiteral(authorization(atom("team_asserter"), SUPPLY_FACTS, example.query.space))));
  assert.ok(parentAtChild >= 0);
  const changed = replaceBundle(original, example.docsBundle, output => ({ ...output, supplier: atom("team_asserter") }), true);
  const proof = replacePremises(changed, example.bobCount, refs => { refs[1] = parentAtChild; });
  assert.equal(verifier.verify({ query: example.query, proof: encodeProof(proof) }).permitted, true);
});
test("authenticated timestamps are retained but impose no age or expiry policy", () => {
  const example = documentProof();
  for (const time of [encodeInt(0n), encodeInt(2n ** 80n)] as Value[]) {
    const original = decodeProof(example.proof);
    const proof = { ...original, bundles: original.bundles.map(bundle => signExampleFacts({ ...decodeSpaceFacts(bundle.payload), assertedAt: time })) };
    assert.ok(decodeSpaceFacts(proof.bundles[0]!.payload).assertedAt.equals(time));
    assert.equal(verifier.verify({ query: example.query, proof: encodeProof(proof) }).permitted, true);
  }
});
test("authentication is required and adapter failure never grants permission", () => {
  assert.throws(() => createSpacesVerifier({ root: ROOT } as Parameters<typeof createSpacesVerifier>[0]), /adapter/);
  const example = documentProof();
  for (const authenticate of [() => false, () => { throw new Error("Authentication unavailable"); }, () => Promise.resolve(true)]) {
    const bad = createSpacesVerifier({ root: ROOT, authenticate: authenticate as never });
    assert.equal(bad.verify(example).permitted, false);
  }
});
test("the fixed layer identity is checked independently of the core identity", () => {
  const example = documentProof(), proof = decodeProof(example.proof);
  assert.equal(verifier.verify({ query: example.query, proof: encodeProof({ ...proof, layer: new Atom(new Uint8Array(32)) }) }).code, "layer-mismatch");
});
