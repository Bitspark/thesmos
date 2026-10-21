import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Atom, BodyLit, Clause, Goal, Term, Tuple } from "@bitspark/logos-contract";
import { decode, encode } from "@bitspark/ontos-codec";
import { encodeText } from "@bitspark/ontos-data";
import { atom, attributedClause, createSpacesVerifier, fact, inspectAttributedClause, path } from "../src/index.js";
import { decodeIssuerSubjectPrincipal, issuerSubjectPrincipal } from "../src/identity.js";
import { authenticateArchon } from "../src/archon.js";
import { prove, ProofSearchError } from "../src/client.js";
import {
  accountBundles, alice, bob, carol, conditionalGrant, grantor, issuer,
  operations, root, runAccountExample, spaces, team,
} from "../../../examples/account-principals.js";

test("issuer-subject encoding preserves native text exactly without identity aliases", () => {
  const subject = "\uFEFFé/账户/🙂", source = "https://accounts.example/é";
  const value = issuerSubjectPrincipal(source, subject);
  assert.deepEqual(decodeIssuerSubjectPrincipal(decode(encode(value))), { issuer: source, subject });
  for (const other of [
    issuerSubjectPrincipal(source + "/", subject),
    issuerSubjectPrincipal(source.toUpperCase(), subject),
    issuerSubjectPrincipal(source, subject.replace("é", "e\u0301")),
    issuerSubjectPrincipal(source, subject.slice(1)),
    atom(subject),
  ]) assert.equal(value.equals(other), false);
  for (const [a, b] of [["", "subject"], [issuer, ""], ["\uD800", "x"], [issuer, "\uDC00"]]) {
    assert.throws(() => issuerSubjectPrincipal(a!, b!));
  }
});

test("identity decoder rejects malformed or other-profile values", () => {
  const tag = atom("thesmos/issuer-subject/1"), a = encodeText(issuer), b = encodeText("alice");
  for (const value of [
    atom("alice"), new Tuple([tag, a]), new Tuple([tag, a, b, b]),
    new Tuple([atom("other/profile"), a, b]), new Tuple([tag, atom(issuer), b]),
    new Tuple([tag, encodeText(""), b]), new Tuple([tag, a, encodeText("")]),
    new Tuple([tag, a, new Tuple([atom("utf8-text"), new Atom([255])])]),
  ]) assert.throws(() => decodeIssuerSubjectPrincipal(value));
});

test("record inspection reuses clause syntax checks and preserves variables without granting authority", () => {
  const clause = attributedClause(bob, team, conditionalGrant);
  const before = clause.body;
  const inspected = inspectAttributedClause(clause);
  assert.equal(inspected.author.equals(bob), true);
  assert.equal(inspected.space.equals(team), true);
  assert.equal(clause.body, before);
  assert.equal(Term.isGround(clause.head.args[2]!), false);
  assert.equal(inspectAttributedClause(attributedClause(alice, team, operations[0]!)).author.equals(alice), true);
  assert.throws(() => inspectAttributedClause(conditionalGrant));
  assert.throws(() => inspectAttributedClause(new Clause(Goal.of("counts", [
    Term.var("Author"), Term.fromValue(team), Term.fromValue(operations[0]!),
  ]), [])));
  assert.throws(() => inspectAttributedClause(attributedClause(alice, atom("not-a-path"), operations[0]!)));
  const unsupportedBody = new Clause(Goal.of("example", []), [BodyLit.pos(Goal.of("unmodeled", []))]);
  assert.throws(() => inspectAttributedClause(attributedClause(alice, team, unsupportedBody)));
});

test("account actors use full variable and supplier proofs for two unrelated vocabularies", async () => {
  const proofs = await runAccountExample().catch(error => {
    if (error instanceof ProofSearchError) console.error("Account proof kernel outcome:", JSON.stringify(error.cause));
    throw error;
  });
  assert.equal(proofs.length, 2);
});

test("a shaped operation preserves its title variable through both onward delegations", async () => {
  const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
  const bundles = accountBundles({ variableTitle: true });
  for (const title of ["First title", "Another title"]) {
    const query = { actor: carol, statement: fact("title", encodeText(title)), space: spaces[0]! };
    const proof = await prove({ root, query, bundles });
    assert.equal(verifier.verify({ query, proof }).permitted, true);
    assert.equal(verifier.verify({ query: { ...query, statement: fact("title", encodeText("Changed request")) }, proof }).permitted, false);
  }
});

test("a wide-operation policy certifies or reports the precise documented host-capacity stop", async t => {
  const query = { actor: carol, statement: operations[0]!, space: spaces[0]! };
  let proof: Uint8Array;
  try {
    proof = await prove({ root, query, bundles: accountBundles({ operationBound: false }) });
  } catch (error) {
    assert(error instanceof ProofSearchError);
    assert.equal(error.reason, "not_completed");
    assert.equal(error.cause.kind, "not_completed");
    if (error.cause.kind !== "not_completed") throw error;
    const failure = error.cause.cause.failureCause;
    assert.equal(failure.kind, "capability_unavailable");
    if (failure.kind !== "capability_unavailable") throw error;
    assert.equal(failure.scope, "host");
    assert.equal(new TextDecoder().decode(failure.component), "wasm");
    assert.equal(new TextDecoder().decode(failure.capability), "memory");
    t.diagnostic("The unconstrained operation variable reached the default 256 MiB host-memory ceiling; no authority denial was inferred.");
    return;
  }
  assert.equal(createSpacesVerifier({ root, authenticate: authenticateArchon }).verify({ query, proof }).permitted, true);
  t.diagnostic("The wide-operation policy completed with a valid native proof.");
});

test("missing supplier, author or conditional support cannot establish the same account query", async () => {
  const query = { actor: carol, statement: operations[0]!, space: spaces[0]! };
  const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
  const passing = await prove({ root, query, bundles: accountBundles() });
  assert.equal(verifier.verify({ query, proof: passing }).permitted, true);
  const exhausted = (error: unknown) => error instanceof ProofSearchError && error.reason === "exhausted";
  for (const omit of ["supplier", "alice", "observation"] as const) {
    await assert.rejects(prove({ root, query, bundles: accountBundles({ omit }) }), exhausted);
  }
  await assert.rejects(prove({ root, query, bundles: accountBundles({
    aliceAuthor: issuerSubjectPrincipal("https://other.example", "alice"),
  }) }), exhausted);
});

test("ancestor rights are retained and an independent route survives loss of the first route", async () => {
  const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
  for (const actor of [grantor, alice, bob]) {
    const query = { actor, statement: operations[0]!, space: spaces[0]! };
    assert.equal(verifier.verify({ query, proof: await prove({ root, query, bundles: accountBundles() }) }).permitted, true);
  }
  const query = { actor: carol, statement: operations[0]!, space: spaces[0]! };
  for (const omit of [undefined, "alice"] as const) {
    const proof = await prove({ root, query, bundles: accountBundles({ omit, alternative: true }) });
    assert.equal(verifier.verify({ query, proof }).permitted, true);
    assert.equal(verifier.verify({ query: { ...query, space: path("other-team") }, proof }).permitted, false);
  }
});
