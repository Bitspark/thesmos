import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getPublicKey } from "@bitspark/archon";
import { Atom, type Clause, type Derivation } from "@bitspark/logos-contract";
import { loadSearcher } from "@bitspark/logos-kernel";
import { encodeInt } from "@bitspark/ontos-data";
import { atom, attributedClause, authorization, createSpacesVerifier, decodeProof, fact, path, type Value } from "../src/index.js";
import { prove, ProofSearchError } from "../src/client.js";
import { authenticateArchon, signSpaceFacts } from "../src/archon.js";
import { protocol } from "../src/data.js";

// A synthetic delegated-execution shape: a workload acts for a person whose right comes from a
// membership rule, whose intent is a recorded confirmation, and whose workload identity is
// supplied by a delegated child asserter. The vocabulary is fixture data, not a platform convention.
const seed = (n: number) => new Uint8Array(32).fill(n);
const key = (n: number) => new Atom(getPublicKey(seed(n)));
const root = key(41), parent = key(42), child = key(43);
const org = path("org"), project = path("org", "p7"), runtime = path("org", "p7", "runtime");
const time = encodeInt(1792540800n);
const deploy = fact("deploy", atom("payments"), atom("a91"), atom("c7"), atom("r18"));
const execute = (worker: string, operation: Value) =>
  fact("execute_for", atom("bob"), atom(worker), operation, atom("rollout42"), atom("audience"));

async function rules(source: string): Promise<readonly Clause[]> {
  return (await loadSearcher()).parseProgram(source).clauses;
}

async function shapeBundles(nested: boolean) {
  const [aliceDeploy, aliceExecute, aliceStart, mayaMember, acConfirm, noWorkload] = await rules(`
    authorized(alice, deploy(payments, A, C, R), [org, p7, runtime]).
    authorized(alice, execute_for(P, W, Op, Req, Aud), [org, p7, runtime]).
    authorized(alice, start(R, Inner), [org, p7, runtime]).
    authorized(maya, member(P, release_team), [org, p7]).
    authorized(ac, confirmed(P, W, Op, Req, Aud), [org, p7]).
    authorized(no, workload(W, Role), [org, p7, runtime]).`);
  const [deployRule, executeRule, startRule] = await rules(`
    authorized(P, deploy(S, A, C, R), [org, p7, runtime]) :-
      counts(maya, [org, p7], member(P, release_team)).
    authorized(W, execute_for(P, W, deploy(S, A, C, R), Req, Aud), [org, p7, runtime]) :-
      authorized(P, deploy(S, A, C, R), [org, p7, runtime]),
      counts(ac, [org, p7], confirmed(P, W, deploy(S, A, C, R), Req, Aud)),
      counts(no, [org, p7, runtime], workload(W, release_desk)).
    authorized(R, start(R, execute_for(P, W, Op, Req, Aud)), [org, p7, runtime]) :-
      counts(no, [org, p7, runtime], workload(R, runner)),
      authorized(W, execute_for(P, W, Op, Req, Aud), [org, p7, runtime]).`);
  const [bobMember, bobConfirmed, deskWorkload, runnerWorkload] = await rules(`
    member(bob, release_team).
    confirmed(bob, w, deploy(payments, a91, c7, r18), rollout42, audience).
    workload(w, release_desk).
    workload(r1, runner).`);
  const bootstrap = [
    authorization(parent, atom("supply_facts"), org),
    aliceDeploy!, aliceExecute!, ...(nested ? [aliceStart!] : []), mayaMember!, acConfirm!, noWorkload!,
  ].map(input => attributedClause(root, path(), input));
  return [
    signSpaceFacts({ supplier: root, space: path(), assertedAt: time, clauses: bootstrap }, seed(41)),
    signSpaceFacts({ supplier: parent, space: project, assertedAt: time, clauses: [
      attributedClause(parent, project, authorization(child, atom("supply_facts"), runtime)),
      attributedClause(atom("alice"), project, deployRule!),
      attributedClause(atom("alice"), project, executeRule!),
      ...(nested ? [attributedClause(atom("alice"), project, startRule!)] : []),
      attributedClause(atom("maya"), project, bobMember!),
      attributedClause(atom("ac"), project, bobConfirmed!),
    ] }, seed(42)),
    signSpaceFacts({ supplier: child, space: runtime, assertedAt: time, clauses: [
      attributedClause(atom("no"), runtime, deskWorkload!),
      ...(nested ? [attributedClause(atom("no"), runtime, runnerWorkload!)] : []),
    ] }, seed(43)),
  ];
}

function depth(derivation: Derivation): number {
  const memo: number[] = [];
  derivation.nodes.forEach((node, index) => {
    memo[index] = 1 + (node.kind === "rule" ? Math.max(0, ...node.premises.map(p => memo[p as number]!)) : 0);
  });
  return memo[derivation.root]!;
}

/** Prove, verify, and report the measurements this shape is held to. */
async function measure(query: { actor: Value; statement: Value; space: Value }, nested: boolean) {
  const bundles = await shapeBundles(nested);
  const started = performance.now();
  const proof = await prove({ root, query, bundles });
  const searchMs = performance.now() - started;
  const checkStarted = performance.now();
  const decision = createSpacesVerifier({ root, authenticate: authenticateArchon }).verify({ query, proof });
  const checkMs = performance.now() - checkStarted;
  const derivation = decodeProof(proof).derivation;
  return { decision, searchMs, checkMs, bytes: proof.byteLength, nodes: derivation.nodes.length, depth: depth(derivation) };
}

// The margin below the protocol limits this shape must stay within (half of each bound).
const limits = protocol.limits, margin = 0.5;

test("a delegated-execution proof stays well inside search memory and the verifier's limits", async () => {
  const query = { actor: atom("w"), statement: execute("w", deploy), space: runtime };
  const m = await measure(query, false);
  console.log(`delegated execution: search ${m.searchMs.toFixed(0)} ms, check ${m.checkMs.toFixed(0)} ms, ` +
    `${m.bytes} bytes, ${m.nodes} nodes, depth ${m.depth}`);
  assert.equal(m.decision.permitted, true, m.decision.detail);
  assert.ok(m.bytes <= limits.maxProofBytes * margin, `proof bytes ${m.bytes}`);
  assert.ok(m.nodes <= limits.maxProofSteps * margin, `proof nodes ${m.nodes}`);
  assert.ok(m.depth <= limits.maxProofDepth * margin, `proof depth ${m.depth}`);
  // The same evidence does not authorize a changed operation or another workload.
  const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
  const proof = await prove({ root, query, bundles: await shapeBundles(false) });
  assert.equal(verifier.verify({ query: { ...query, statement: execute("w", fact("deploy", atom("payments"), atom("a92"), atom("c7"), atom("r18"))) }, proof }).permitted, false);
  assert.equal(verifier.verify({ query: { ...query, actor: atom("w2"), statement: execute("w2", deploy) }, proof }).permitted, false);
});

// A counted grant confers only when its placement prefixes the grant's UNDERLYING space. A grant to
// `[]` placed at `[p]` confers nothing, even for the target `[p]` that both paths prefix; the same
// grant placed at `[]` reaches `[p]` through descendant authority. Every evaluator must agree.
test("a grant placed below its underlying space confers nothing, even where both paths prefix the target", async () => {
  const p = path("p"), alice = atom("alice"), read = atom("read");
  const query = { actor: alice, statement: read, space: p };
  const grantAt = (placement: Value) => [signSpaceFacts({ supplier: root, space: placement, assertedAt: time,
    clauses: [attributedClause(root, placement, authorization(alice, read, path()))] }, seed(41))];
  await assert.rejects(prove({ root, query, bundles: grantAt(p) }),
    (error: unknown) => error instanceof ProofSearchError && error.reason === "exhausted");
  const control = await prove({ root, query, bundles: grantAt(path()) });
  assert.equal(createSpacesVerifier({ root, authenticate: authenticateArchon }).verify({ query, proof: control }).permitted, true);
});

test("one more level of nesting either proves within the limits or reports an incomplete search", async () => {
  const query = { actor: atom("r1"), statement: fact("start", atom("r1"), execute("w", deploy)), space: runtime };
  try {
    const m = await measure(query, true);
    console.log(`nested start: search ${m.searchMs.toFixed(0)} ms, check ${m.checkMs.toFixed(0)} ms, ` +
      `${m.bytes} bytes, ${m.nodes} nodes, depth ${m.depth}`);
    assert.equal(m.decision.permitted, true, m.decision.detail);
    assert.ok(m.nodes <= limits.maxProofSteps && m.bytes <= limits.maxProofBytes && m.depth <= limits.maxProofDepth);
  } catch (error) {
    // A proof exists, so "exhausted" would be a wrong answer; only an incomplete search is acceptable.
    assert.ok(error instanceof ProofSearchError && error.reason === "not_completed", String(error));
    console.log(`nested start: search not completed: ${JSON.stringify(error.cause, (_, v) => typeof v === "bigint" ? String(v) : v).slice(0, 400)}`);
  }
});
