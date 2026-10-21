import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Atom, BodyLit, Clause, Goal, Term, Tuple } from "@bitspark/logos-contract";
import { decode, encode } from "@bitspark/ontos-codec";
import { encodeText } from "@bitspark/ontos-data";
import { atom, attributedClause, createSpacesVerifier, inspectAttributedClause, path } from "../src/index.js";
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
  assert.equal((await runAccountExample()).length, 2);
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
