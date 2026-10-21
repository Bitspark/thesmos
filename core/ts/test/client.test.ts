import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getPublicKey, sign, signInDomain } from "@bitspark/archon";
import { Atom } from "@bitspark/logos-contract";
import { loadSearcher, RunLimits } from "@bitspark/logos-kernel";
import { encodeInt } from "@bitspark/ontos-data";
import {
  atom, authorization, attributedClause, createSpacesVerifier, decodeProof,
  decodeSpaceFacts, encodeProof, encodeSpaceFacts, fact, path,
} from "../src/index.js";
import { prove, ProofSearchError, type ProofSearchFailure } from "../src/client.js";
import { authenticateArchon, signSpaceFacts } from "../src/archon.js";
import { bob, documentBundles, root, runDocumentExample, space, statement } from "../../../examples/document-service.js";

const failsAs = (reason: ProofSearchFailure) => (error: unknown) =>
  error instanceof ProofSearchError && error.reason === reason && error.name === "ProofSearchError"
    && error.cause.kind !== undefined && !Object.keys(error).includes("cause");

test("native Logos search constructs the complete document proof", async () => {
  const { proof, query } = await runDocumentExample();
  const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
  assert.equal(verifier.verify({ query: { ...query, space: path("sibling") }, proof }).permitted, false);
  assert.equal(createSpacesVerifier({ root: atom("different_root"), authenticate: authenticateArchon }).verify({ query, proof }).permitted, false);
  assert.equal(decodeProof(proof).bundles.length, 3);
});

test("Archon authenticates exact payload and domain, separately from authority", async () => {
  const query = { actor: bob, space, statement };
  const proof = decodeProof(await prove({ root, query, bundles: documentBundles() }));
  const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
  const first = proof.bundles[0]!;
  for (const signature of [
    sign(first.payload, new Uint8Array(32).fill(1)),
    signInDomain(new Uint8Array(32).fill(1), "another/protocol/v1", first.payload),
  ]) {
    const bundles = [{ ...first, authentication: new Atom(signature) }, ...proof.bundles.slice(1)];
    assert.equal(verifier.verify({ query, proof: encodeProof({ ...proof, bundles }) }).code, "authentication-failed");
  }
  const changed = { ...decodeSpaceFacts(first.payload), assertedAt: encodeInt(0n) };
  const bundles = [{ ...first, payload: encodeSpaceFacts(changed) }, ...proof.bundles.slice(1)];
  assert.equal(verifier.verify({ query, proof: encodeProof({ ...proof, bundles }) }).code, "authentication-failed");
});

test("native search binds an authored variable rule and checks each conclusion", async () => {
  const seed = new Uint8Array(32).fill(9), anchor = new Atom(getPublicKey(seed));
  const author = atom("alice"), recipient = atom("carol"), at = path("documents");
  const edit7 = fact("edit", atom("doc7")), edit8 = fact("edit", atom("doc8"));
  const parser = await loadSearcher();
  const rule = parser.parseProgram("authorized(P,edit(D),S) :- counts(R,[],approved(P,D,S)).").clauses[0]!;
  const bundles = [signSpaceFacts({ supplier: anchor, space: path(), assertedAt: encodeInt(0n), clauses: [
    attributedClause(anchor, path(), authorization(author, edit7, at)),
    attributedClause(anchor, path(), fact("approved", recipient, atom("doc7"), at)),
    attributedClause(anchor, path(), fact("approved", recipient, atom("doc8"), at)),
    attributedClause(author, path(), rule),
  ] }, seed)];
  const query = { actor: recipient, statement: edit7, space: at };
  const proof = await prove({ root: anchor, query, bundles });
  const verifier = createSpacesVerifier({ root: anchor, authenticate: authenticateArchon });
  assert.equal(verifier.verify({ query, proof }).permitted, true);
  assert.equal(verifier.verify({ query: { ...query, statement: edit8 }, proof }).permitted, false);
  await assert.rejects(prove({ root: anchor, query: { ...query, statement: edit8 }, bundles }), failsAs("exhausted"));
});

test("an ancestor can supply child facts directly and delegation retains its right", async () => {
  const seed = new Uint8Array(32).fill(10), anchor = new Atom(getPublicKey(seed));
  const child = path("a", "b"), actor = atom("actor"), operation = fact("edit", atom("item"));
  const bundles = [signSpaceFacts({ supplier: anchor, space: child, assertedAt: encodeInt(0n),
    clauses: [attributedClause(anchor, child, authorization(actor, operation, child))],
  }, seed)];
  const verifier = createSpacesVerifier({ root: anchor, authenticate: authenticateArchon });
  for (const id of [anchor, actor]) {
    const query = { actor: id, statement: operation, space: child };
    const proof = await prove({ root: anchor, query, bundles });
    assert.equal(verifier.verify({ query, proof }).permitted, true);
  }
});

test("valid signatures cannot bootstrap a self-appointed supplier", async () => {
  const seed = new Uint8Array(32).fill(11), outsider = new Atom(getPublicKey(seed));
  const query = { actor: bob, statement, space };
  const bundles = [signSpaceFacts({ supplier: outsider, space, assertedAt: encodeInt(0n), clauses: [
    attributedClause(outsider, space, authorization(outsider, atom("supply_facts"), space)),
    attributedClause(outsider, space, authorization(bob, statement, space)),
  ] }, seed)];
  await assert.rejects(prove({ root, query, bundles }), failsAs("exhausted"));
});

test("a search stopped before completion is not reported as exhausted", async () => {
  const query = { actor: bob, space, statement };
  const limits = { ...RunLimits.default(), searchNodes: 1 };
  await assert.rejects(prove({ root, query, bundles: documentBundles(), limits }), failsAs("not_completed"));
  await assert.rejects(prove({ root, query, bundles: documentBundles() }, AbortSignal.abort()), failsAs("not_completed"));
});
