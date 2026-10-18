import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Atom, clauseValue, Derivation, Tuple } from "@bitspark/logos-contract";
import { loadSearcher, parseVerdict } from "@bitspark/logos-kernel";
import { decode, encode } from "@bitspark/ontos-codec";
import { encodeInt, encodeText } from "@bitspark/ontos-data";
import { atom, createSpacesVerifier, decodeProof, decodeSpaceFacts, encodeProof, fact, path } from "../src/index.js";
import { decodeCases } from "./fixtures/conformance-format.js";
import { confer, deviceProof, documentProof, releaseProof, ROOT, rootCounts, rootGrant, rootSupplied } from "./fixtures/proofs.js";
import { DocumentService, DeviceService, ReleaseService } from "./fixtures/services.js";
import { authenticateExampleFacts } from "./fixtures/authentication.js";
import { protocol } from "../src/data.js";
import { attributedClause, executableClause, literalValue } from "../src/encoding.js";
import { ProofBuilder } from "../test/recipes.js";

const require = createRequire(import.meta.url);
const cases = decodeCases(readFileSync(require.resolve("@bitspark/thesmos/law/conformance.ontos")));
for (const fixture of cases) test(fixture.name + ": " + fixture.why, () => {
  const result = createSpacesVerifier({ root: fixture.root, authenticate: authenticateExampleFacts }).verify({ query: fixture.query, proof: fixture.proof });
  assert.equal(result.permitted, fixture.permitted, JSON.stringify(result));
});

test("sample services execute only the operation whose query the proof establishes", () => {
  const docs = new DocumentService(ROOT, authenticateExampleFacts), devices = new DeviceService(ROOT, authenticateExampleFacts), releases = new ReleaseService(ROOT, authenticateExampleFacts);
  const doc = documentProof(), dev = deviceProof(), rel = releaseProof();
  assert.equal(docs.rename("bob", "doc7", "Reconciled model", doc.proof).permitted, true);
  assert.equal(docs.rename("bob", "doc7", "Changed", doc.proof).permitted, false);
  assert.equal(docs.documents.get("doc7"), "Reconciled model");
  assert.equal(devices.setTemperature("technician", "device7", 21, dev.proof).permitted, true);
  assert.equal(devices.setTemperature("technician", "device7", 99, dev.proof).permitted, false);
  assert.equal(devices.temperatures.get("device7"), 21);
  assert.equal(releases.deploy("carol", "widget", "r1", rel.proof).permitted, true);
  assert.equal(releases.deploy("carol", "widget", "r2", rel.proof).permitted, false);
  assert.equal(releases.releases.get("widget"), "r1");
});
test("malformed bytes and the removed JSON format do not establish permission", () => {
  const { query, proof } = documentProof(), verifier = createSpacesVerifier({ root: ROOT, authenticate: authenticateExampleFacts });
  for (const bytes of [new Uint8Array(), Buffer.from("{}"), Buffer.from('{"format":"spaces-proof/2"}'), proof.slice(0, -1), Uint8Array.from([...proof, 0])]) {
    assert.equal(verifier.verify({ query, proof: bytes }).code, protocol.results.invalid);
  }
});
test("byte, wire-depth and node limits refuse without claiming non-derivability", () => {
  const { query, proof } = documentProof(), verifier = createSpacesVerifier({ root: ROOT, authenticate: authenticateExampleFacts });
  assert.equal(verifier.verify({ query, proof: new Uint8Array(protocol.limits.maxProofBytes + 1) }).code, protocol.results.limit);
  let nested = atom("x") as Atom | Tuple;
  for (let i = 0; i < protocol.limits.maxWireDepth + 2; i++) nested = new Tuple([nested]);
  assert.equal(verifier.verify({ query, proof: encode(nested) }).code, protocol.results.limit);
  const native = decodeProof(proof);
  const many = new Derivation(Array.from({ length: protocol.limits.maxProofSteps + 1 }, () => native.derivation.nodes[0]!), 0);
  assert.equal(verifier.verify({ query, proof: encodeProof({ ...native, derivation: many }) }).code, protocol.results.limit);
});
test("the exact query is rechecked on every call", () => {
  const { query, proof } = documentProof(), verifier = createSpacesVerifier({ root: ROOT, authenticate: authenticateExampleFacts });
  assert.equal(verifier.verify({ query, proof }).permitted, true);
  assert.equal(verifier.verify({ query: { ...query, actor: atom("mallory") }, proof }).permitted, false);
  assert.equal(verifier.verify({ query, proof }).permitted, true);
});
test("native proof round trips preserve every byte including authored clauses", () => {
  for (const { proof } of [documentProof(), deviceProof(), releaseProof()]) assert.deepEqual(encodeProof(decodeProof(proof)), proof);
});
test("Ontos binary identities and large integer parameters stay distinct", () => {
  const p = new ProofBuilder(), root = new Atom(Uint8Array.of(255, 0, 128)), actor = new Atom(Uint8Array.of(129, 254));
  const space = path("binary"), number = 2n ** 100n, statement = fact("payload", encodeInt(number), new Atom(Uint8Array.of(0, 255)));
  // Root grant recipe uses the fixture root, so write this root's two nodes explicitly.
  const authority = p.apply("root-authority", { R: root, F: statement, S: space }, [p.anchor(root)]);
  const proof = p.finish(authority), verifier = createSpacesVerifier({ root, authenticate: authenticateExampleFacts });
  assert.equal(verifier.verify({ query: { actor: root, space, statement }, proof }).permitted, true);
  assert.equal(verifier.verify({ query: { actor, space, statement }, proof }).permitted, false);
  for (const changed of [encodeInt(number + 1n), encodeText(number.toString())]) {
    assert.equal(verifier.verify({ query: { actor: root, space, statement: fact("payload", changed, new Atom(Uint8Array.of(0, 255))) }, proof }).permitted, false);
  }
});
test("the same variable rule checks each conclusion and needs no publication grant", async () => {
  const parser = await loadSearcher();
  const clause = parser.parseProgram("authorized(A,edit(H),S) :- counts(root_key,[],approved(A,H,S)).").clauses[0]!;
  const author = atom("alice"), bob = atom("bob"), space = path("docs");
  for (const document of ["doc7", "doc8"]) {
    const p = new ProofBuilder(), anchor = p.anchor(ROOT), value = atom(document), statement = fact("edit", value);
    const held = rootGrant(p, anchor, author, fact("edit", atom("doc7")), space);
    const approved = rootCounts(p, anchor, fact("approved", bob, value, space), path());
    const conclusion = p.apply("may-confer", { I: author, J: bob, F: statement, T: space, S: space }, [held]);
    const counted = rootSupplied(p, author, space, clause, { A: bob, H: value, S: space }, [approved, conclusion]);
    const permission = confer(p, counted, author, space, bob, statement, space);
    const result = createSpacesVerifier({ root: ROOT, authenticate: authenticateExampleFacts }).verify({ query: { actor: bob, statement, space }, proof: p.finish(permission) });
    assert.equal(result.permitted, document === "doc7", JSON.stringify(result));
  }
});
test("authored clauses execute directly with the original variables, attribution and conclusion guard", async () => {
  const parser = await loadSearcher();
  const example = releaseProof(), policy = decodeSpaceFacts(decodeProof(example.proof).bundles[example.policyIndex]!.payload).clauses[0]!;
  const expected = parser.parseProgram(`counts(maintainer,[project],authorized(carol,deployed(widget,Release),[project])) :-
    counts(reviewer,[project],approved(widget,Release)),
    authorized(maintainer,authorized(carol,deployed(widget,Release),[project]),[project]).`);
  assert.equal(parseVerdict(expected).kind, "parsed");
  assert.equal(clauseValue(executableClause(policy)).equals(clauseValue(expected.clauses[0]!)), true);
});

test("ordinary facts and explicit empty-body rules use the same native clause", async () => {
  const parser = await loadSearcher();
  const clause = parser.parseProgram("approved(bob,doc7).").clauses[0]!;
  const author = atom("alice"), space = path("docs"), value = fact("approved", atom("bob"), atom("doc7"));
  const direct = attributedClause(author, space, value), explicit = attributedClause(author, space, clause);
  assert.equal(direct.body.length, 0);
  assert.equal(clauseValue(direct).equals(clauseValue(explicit)), true);
  const expected = parser.parseProgram("counts(alice,[docs],approved(bob,doc7)) :- authorized(alice,approved(bob,doc7),[docs]).").clauses[0]!;
  assert.equal(clauseValue(executableClause(direct)).equals(clauseValue(expected)), true);
});

test("empty-body inputs preserve exact native values, including atom versus nullary compound", () => {
  const values = [atom("ready"), fact("ready"), new Atom(Uint8Array.of(255, 0, 128)), new Tuple([]), new Tuple([new Tuple([])])];
  for (const value of values) {
    const clause = attributedClause(ROOT, path(), value), executable = executableClause(clause);
    assert.equal(clause.body.length, 0);
    assert.equal(executable.head.asGround()!.args[2]!.equals(value), true);
    assert.equal(executable.body[0]!.lit.asGround()!.args[1]!.equals(value), true);
  }
  assert.equal(clauseValue(attributedClause(ROOT, path(), values[0]!)).equals(clauseValue(attributedClause(ROOT, path(), values[1]!))), false);
});
test("the superseded proof envelope is rejected without a compatibility decoder", () => {
  const { query, proof } = releaseProof();
  for (const format of ["spaces/proof/3", "spaces/proof/4", "spaces/proof/5"]) {
    const envelope = new Tuple([atom(format), ...(decode(proof) as Tuple).items().slice(1)]);
    assert.equal(createSpacesVerifier({ root: ROOT, authenticate: authenticateExampleFacts }).verify({ query, proof: encode(envelope) }).code, protocol.results.invalid);
  }
});
test("SDK values and authored clauses match the official Logos source parser", async () => {
  const parser = await loadSearcher();
  const parsed = parser.parseProgram('sample(title(doc7,"Reconciled model"),[team,docs],21,1267650600228229401496703205376).');
  assert.equal(parseVerdict(parsed).kind, "parsed");
  const expected = fact("sample", fact("title", atom("doc7"), encodeText("Reconciled model")), path("team", "docs"), encodeInt(21n), encodeInt(2n ** 100n));
  assert.equal(literalValue(parsed.clauses[0]!.head.asGround()!).equals(expected), true);
  const policy = parser.parseProgram('authorized(carol,deployed(widget,Release),[project]) :- counts(reviewer,[project],approved(widget,Release)).');
  assert.equal(parseVerdict(policy).kind, "parsed");
  const example = releaseProof();
  const attributed = attributedClause(atom("maintainer"), path("project"), policy.clauses[0]!);
  assert.equal(clauseValue(attributed).equals(clauseValue(decodeSpaceFacts(decodeProof(example.proof).bundles[example.policyIndex]!.payload).clauses[0]!)), true);
  const p = new ProofBuilder(), statement = literalValue(parser.parseProgram('title(doc7,"Reconciled model").').clauses[0]!.head.asGround()!);
  const query = { actor: atom("bob"), statement, space: path("team", "docs") };
  const right = rootGrant(p, p.anchor(ROOT), query.actor, statement, query.space);
  assert.equal(createSpacesVerifier({ root: ROOT, authenticate: authenticateExampleFacts }).verify({ query, proof: p.finish(right) }).permitted, true);
});
