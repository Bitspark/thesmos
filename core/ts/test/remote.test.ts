import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { getPublicKey } from "@bitspark/archon";
import { loadSearcher } from "@bitspark/logos-kernel";
import { Atom, Tuple, type Value } from "@bitspark/logos-contract";
import { encode } from "@bitspark/ontos-codec";
import { encodeInt, encodeText } from "@bitspark/ontos-data";
import {
  atom, attributedClause, authorization, createSpacesVerifier, decodeProof, encodeProof, fact, path,
  type SpaceFactsBundle,
} from "../src/index.js";
import { authenticateArchon, signSpaceFacts } from "../src/archon.js";
import { answerProofRequest, createLocalProofProvider } from "../src/client.js";
import {
  createHttpProofProvider, decodeProofRequest, decodeProofResult, encodeProofRequest, encodeProofResult,
  proofMediaType, ProofProviderError, type OutgoingProofRequest, type ProofProviderFailure,
  type ProofRequest, type ProofResult,
} from "../src/remote.js";

// Synthetic keys and vocabulary. The reference provider stands in for any hosting service and
// follows the Accounts disclosure shape: authorized(authenticatedCaller, read_records, placement).
const seed = (n: number) => new Uint8Array(32).fill(n);
const key = (n: number) => new Atom(getPublicKey(seed(n)));
const time = encodeInt(1792540800n);
const readRecords = atom("read_records");

// Vocabulary 1: documents. Bob may read the records placed at [team] and, per those, rename doc7.
const docsRoot = key(51), teamAsserter = key(52);
const team = path("team"), docs = path("team", "docs");
const bob = atom("bob"), carol = atom("carol"), mallory = atom("mallory");
const rename = fact("title", atom("doc7"), encodeText("Reconciled model"));
const publicBundle = signSpaceFacts({ supplier: docsRoot, space: path(), assertedAt: time, clauses: [
  attributedClause(docsRoot, path(), authorization(teamAsserter, atom("supply_facts"), team)),
  attributedClause(docsRoot, path(), authorization(bob, readRecords, team)),
] }, seed(51));
const teamRecords = signSpaceFacts({ supplier: teamAsserter, space: team, assertedAt: time, clauses: [
  attributedClause(docsRoot, team, authorization(bob, rename, team)),
] }, seed(52));
const renameQuery = { actor: bob, statement: rename, space: docs };
const readQuery = (actor: Value) => ({ actor, statement: readRecords, space: team });
const placements = (...spaces: Value[]) => new Tuple(spaces);
const docsVerifier = createSpacesVerifier({ root: docsRoot, authenticate: authenticateArchon });

// Vocabulary 2: devices, under an unrelated root and a separately configured provider.
const deviceRoot = key(61), technician = atom("technician"), devices = path("devices");
const temperature = fact("temperature", atom("device7"), encodeInt(21n));
const deviceBundle = signSpaceFacts({ supplier: deviceRoot, space: devices, assertedAt: time, clauses: [
  attributedClause(deviceRoot, devices, authorization(technician, temperature, devices)),
] }, seed(61));
const deviceQuery = { actor: technician, statement: temperature, space: devices };

type Raw = { readonly raw: { readonly status: number; readonly type: string; readonly body: Uint8Array; readonly chunked?: boolean } };
type Handler = (call: { caller?: Value; audience?: string }, request: ProofRequest) => Promise<ProofResult | Raw>;

/** An in-process HTTP provider. Caller identity comes from (test) transport headers only. */
async function serve(handlerFor: (url: string) => Handler) {
  let requests = 0, url = "";
  let handler: Handler = async () => ({ kind: "failure", code: "provider_unavailable" });
  const server = createServer(async (req, res) => {
    requests++;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const caller = req.headers["x-test-caller"], audience = req.headers["x-test-audience"];
    let out: ProofResult | Raw;
    let request: ProofRequest | undefined;
    try { request = decodeProofRequest(new Uint8Array(Buffer.concat(chunks))); } catch { /* typed below */ }
    try {
      out = request === undefined ? { kind: "failure", code: "invalid_request" }
        : await handler({ ...(typeof caller === "string" ? { caller: atom(caller) } : {}),
          ...(typeof audience === "string" ? { audience } : {}) }, request);
    } catch {
      out = { raw: { status: 500, type: "text/plain", body: new TextEncoder().encode("handler failed") } };
    }
    if ("raw" in out && out.raw.chunked) {
      res.writeHead(out.raw.status, { "content-type": out.raw.type });
      for (let i = 0; i < out.raw.body.length; i += 16) res.write(Buffer.from(out.raw.body.subarray(i, i + 16)));
      res.end();
    } else if ("raw" in out) {
      res.writeHead(out.raw.status, { "content-type": out.raw.type }).end(Buffer.from(out.raw.body));
    } else {
      res.writeHead(200, { "content-type": proofMediaType }).end(Buffer.from(encodeProofResult(out)));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/native/v1/proofs`;
  handler = handlerFor(url);
  return {
    url, get requests() { return requests; },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

const spaceKey = (space: Value) => Buffer.from(encode(space)).toString("hex");

/**
 * A reference provider. It authenticates the caller and audience from transport, and discloses
 * the records at each selected exact placement only if a presented proof establishes
 * authorized(authenticatedCaller, read_records, placement) under the PROVIDER's own root, never
 * the request's root and never for the request's queried actor.
 */
function referenceProvider(config: {
  readonly root: Value;
  readonly records?: ReadonlyMap<string, readonly SpaceFactsBundle[]>;
  readonly unavailable?: ReadonlySet<string>;
  readonly revalidate?: () => boolean;
}) {
  const verifier = createSpacesVerifier({ root: config.root, authenticate: authenticateArchon });
  return (url: string): Handler => async (call, request) => {
    if (call.audience !== url || call.caller === undefined) return { kind: "failure", code: "unauthenticated" };
    const selected: SpaceFactsBundle[] = [];
    const observations = [];
    if (request.selection !== undefined) {
      if (!(request.selection instanceof Tuple) || request.selection.length === 0) return { kind: "failure", code: "invalid_request" };
      for (const placement of request.selection.items()) {
        const id = spaceKey(placement);
        if (config.unavailable?.has(id)) return { kind: "failure", code: "evidence_unavailable", detail: "source unavailable" };
        const records = config.records?.get(id);
        if (!records) return { kind: "failure", code: "evidence_unavailable", detail: "no records at that placement" };
        const query = { actor: call.caller, statement: readRecords, space: placement };
        if (!(request.disclosureProofs ?? []).some(proof => verifier.verify({ query, proof }).permitted)) {
          return { kind: "failure", code: "disclosure_refused" };
        }
        selected.push(...records);
      }
      observations.push({ source: atom("reference-records"), position: encodeInt(7n) });
    }
    return answerProofRequest(request, {
      bundles: selected, authenticate: authenticateArchon, observations,
      ...(request.selection !== undefined && config.revalidate ? { revalidate: config.revalidate } : {}),
    });
  };
}

const as = (caller: string, audience?: string) => ({
  authenticate: ({ headers, url, method }: OutgoingProofRequest) => {
    assert.equal(method, "POST");
    assert.equal(headers.get("content-type"), proofMediaType);
    headers.set("x-test-caller", caller);
    headers.set("x-test-audience", audience ?? url.href);
  },
});
const flipLast = (bytes: Uint8Array) => { const out = Uint8Array.from(bytes); out[out.length - 1]! ^= 1; return out; };
const failsWith = (code: ProofProviderFailure) => (error: unknown) =>
  error instanceof ProofProviderError && error.code === code;
const docsRecordsMap = new Map([[spaceKey(team), [teamRecords]]]);
const docsProvider = () => serve(referenceProvider({ root: docsRoot, records: docsRecordsMap,
  unavailable: new Set([spaceKey(path("archive"))]) }));

test("proof request and result codecs round-trip and refuse malformed input", () => {
  const request: ProofRequest = {
    root: docsRoot, query: renameQuery, bundles: [publicBundle], selection: placements(team),
    disclosureProofs: [new Uint8Array([1, 2, 3])], budget: { deadlineMs: 5000, searchNodes: 100 },
  };
  const decoded = decodeProofRequest(encodeProofRequest(request));
  assert.equal(decoded.root.equals(docsRoot), true);
  assert.equal(decoded.query.statement.equals(rename), true);
  assert.deepEqual(decoded.bundles![0]!.payload, publicBundle.payload);
  assert.equal(decoded.bundles![0]!.authentication.equals(publicBundle.authentication), true);
  assert.equal(decoded.selection!.equals(placements(team)), true);
  assert.deepEqual(decoded.disclosureProofs, [new Uint8Array([1, 2, 3])]);
  assert.deepEqual(decoded.budget, { deadlineMs: 5000, searchNodes: 100 });
  const minimal = decodeProofRequest(encodeProofRequest({ root: docsRoot, query: renameQuery }));
  assert.equal(minimal.selection, undefined);
  assert.deepEqual(minimal.budget, {});

  const proofResult = decodeProofResult(encodeProofResult({ kind: "proof", proof: new Uint8Array([9]),
    observations: [{ source: atom("s"), position: encodeInt(3n) }] }));
  assert.equal(proofResult.kind, "proof");
  for (const code of ["disclosure_refused", "evidence_changed", "provider_refused"] as const) {
    assert.deepEqual(decodeProofResult(encodeProofResult({ kind: "failure", code, detail: "why" })),
      { kind: "failure", code, detail: "why" });
  }

  assert.throws(() => encodeProofRequest({ ...request, budget: { searchNodes: -1 } }), TypeError);
  assert.throws(() => decodeProofRequest(encodeProofRequest(request), 16), RangeError);
  assert.throws(() => decodeProofRequest(encodeProofResult({ kind: "failure", code: "exhausted" })), TypeError);
  assert.throws(() => encodeProofResult({ kind: "failure", code: "permitted" as ProofProviderFailure }), TypeError);
  const unknownCode = encode(new Tuple([atom("spaces/proof-result/1"), new Tuple([atom("failure"), atom("permitted"), new Tuple([])])]));
  assert.throws(() => decodeProofResult(unknownCode), TypeError);
  assert.throws(() => encodeProofRequest({ ...request, budget: { deadlineMs: 2 ** 31 } }), TypeError);
  const overDeadline = encode(new Tuple([atom("spaces/proof-request/1"), docsRoot,
    new Tuple([bob, team, rename]), new Tuple([]), new Tuple([]), new Tuple([]),
    new Tuple([new Tuple([encodeInt(2n ** 31n)]), new Tuple([]), new Tuple([])])]));
  assert.throws(() => decodeProofRequest(overDeadline), TypeError);
});

test("two-stage disclosure works remotely, with no local search, and matches local production", async () => {
  const server = await docsProvider();
  try {
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    // Stage 1: the read right comes from supplied public evidence alone.
    const read = await client.produce({ root: docsRoot, query: readQuery(bob), bundles: [publicBundle] });
    assert.equal(docsVerifier.verify({ query: readQuery(bob), proof: read.proof }).permitted, true);
    assert.deepEqual(read.observations, []);
    // Stage 2: that proof discloses the records at [team] for the actual operation's proof.
    const remote = await client.produce({ root: docsRoot, query: renameQuery, bundles: [publicBundle],
      selection: placements(team), disclosureProofs: [read.proof] });
    assert.equal(docsVerifier.verify({ query: renameQuery, proof: remote.proof }).permitted, true);
    assert.equal(remote.observations.length, 1);
    const carried = decodeProof(remote.proof).bundles.map(bundle => Buffer.from(bundle.payload).toString("hex"));
    for (const payload of carried) {
      assert.ok([publicBundle, teamRecords].some(b => Buffer.from(b.payload).toString("hex") === payload));
    }
    // The same inputs produced locally yield a proof of the same exact query.
    const local = await createLocalProofProvider({ bundles: [teamRecords], authenticate: authenticateArchon })
      .produce({ root: docsRoot, query: renameQuery, bundles: [publicBundle] });
    assert.equal(docsVerifier.verify({ query: renameQuery, proof: local.proof }).permitted, true);
    assert.equal(docsVerifier.verify({ query: { ...renameQuery, actor: carol }, proof: remote.proof }).permitted, false);
    // A selection the derivation does not use leaves no observation: they describe selected evidence only.
    const unused = await client.produce({ root: docsRoot, query: readQuery(bob), bundles: [publicBundle],
      selection: placements(team), disclosureProofs: [read.proof] });
    assert.deepEqual(unused.observations, []);
  } finally { await server.close(); }
});

test("caller authentication, disclosure authority, caller/actor and root confusion are refused", async () => {
  const server = await docsProvider();
  try {
    const target = { root: docsRoot, query: renameQuery, bundles: [publicBundle], selection: placements(team) };
    const bobRead = await createHttpProofProvider({ endpoint: server.url, ...as("bob") })
      .produce({ root: docsRoot, query: readQuery(bob), bundles: [publicBundle] });
    // Wrong audience, and no caller authentication at all.
    await assert.rejects(createHttpProofProvider({ endpoint: server.url, ...as("bob", "https://elsewhere.example/") })
      .produce({ ...target, disclosureProofs: [bobRead.proof] }), failsWith("unauthenticated"));
    await assert.rejects(createHttpProofProvider({ endpoint: server.url })
      .produce({ ...target, disclosureProofs: [bobRead.proof] }), failsWith("unauthenticated"));
    const asCarol = createHttpProofProvider({ endpoint: server.url, ...as("carol") });
    // Carol holds no read right: her own read proof cannot be produced, and nothing is disclosed.
    await assert.rejects(asCarol.produce({ root: docsRoot, query: readQuery(carol), bundles: [publicBundle] }),
      failsWith("exhausted"));
    await assert.rejects(asCarol.produce(target), failsWith("disclosure_refused"));
    // Bob's read proof does not authorize Carol: disclosure is decided for the caller, not the actor.
    await assert.rejects(asCarol.produce({ ...target, disclosureProofs: [bobRead.proof] }), failsWith("disclosure_refused"));
    // The queried actor is a goal term: Carol may obtain a proof about Bob from public evidence.
    const aboutBob = await asCarol.produce({ root: docsRoot, query: readQuery(bob), bundles: [publicBundle] });
    assert.equal(docsVerifier.verify({ query: readQuery(bob), proof: aboutBob.proof }).permitted, true);
    // A caller's own root computes over its own evidence but never chooses the disclosure anchor.
    const malloryRoot = key(81);
    const asMallory = createHttpProofProvider({ endpoint: server.url, ...as("mallory") });
    const ownRead = await asMallory.produce({ root: malloryRoot, query: readQuery(mallory), bundles: [
      signSpaceFacts({ supplier: malloryRoot, space: path(), assertedAt: time, clauses: [
        attributedClause(malloryRoot, path(), authorization(mallory, readRecords, team))] }, seed(81))] });
    assert.equal(createSpacesVerifier({ root: malloryRoot, authenticate: authenticateArchon })
      .verify({ query: readQuery(mallory), proof: ownRead.proof }).permitted, true);
    await assert.rejects(asMallory.produce({ ...target, root: malloryRoot, disclosureProofs: [ownRead.proof] }),
      failsWith("disclosure_refused"));
    // Unavailable and unknown sources are distinct from refusal.
    const asBob = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    await assert.rejects(asBob.produce({ ...target, selection: placements(path("archive")), disclosureProofs: [bobRead.proof] }),
      failsWith("evidence_unavailable"));
    await assert.rejects(asBob.produce({ ...target, selection: placements(path("missing")), disclosureProofs: [bobRead.proof] }),
      failsWith("evidence_unavailable"));
  } finally { await server.close(); }
});

test("a selection that changes during search is not released", async () => {
  const server = await serve(referenceProvider({ root: docsRoot, records: docsRecordsMap, revalidate: () => false }));
  try {
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    const read = await client.produce({ root: docsRoot, query: readQuery(bob), bundles: [publicBundle] });
    await assert.rejects(client.produce({ root: docsRoot, query: renameQuery, bundles: [publicBundle],
      selection: placements(team), disclosureProofs: [read.proof] }), failsWith("evidence_changed"));
  } finally { await server.close(); }
});

test("revalidation distinguishes an unavailable re-read and is skipped when the selection is unused", async () => {
  let calls = 0;
  const answer = (query: { actor: Value; statement: Value; space: Value }) => answerProofRequest({ root: docsRoot, query, bundles: [publicBundle] }, {
    authenticate: authenticateArchon, bundles: [teamRecords],
    revalidate: () => { calls++; return "evidence_unavailable"; },
  });
  assert.deepEqual(await answer(renameQuery), { kind: "failure", code: "evidence_unavailable",
    detail: "the selected evidence could not be re-read" });
  assert.equal(calls, 1);
  const unused = await answer(readQuery(bob));
  assert.equal(unused.kind, "proof");
  assert.equal(calls, 1);
});

test("observations computed after revalidation report the final read", async () => {
  let revalidated = false;
  const server = await serve(url => async (call, request) => {
    if (call.audience !== url) return { kind: "failure", code: "unauthenticated" };
    return answerProofRequest(request, {
      authenticate: authenticateArchon, bundles: [teamRecords],
      revalidate: () => { revalidated = true; return true; },
      observations: () => {
        assert.equal(revalidated, true);
        return [{ source: atom("records"), position: encodeInt(42n) }];
      },
    });
  });
  try {
    const produced = await createHttpProofProvider({ endpoint: server.url, ...as("bob") })
      .produce({ root: docsRoot, query: renameQuery, bundles: [publicBundle] });
    assert.equal(produced.observations.length, 1);
    assert.equal(produced.observations[0]!.position.equals(encodeInt(42n)), true);
  } finally { await server.close(); }
});

test("a second vocabulary and a separately configured provider use the same contract", async () => {
  const server = await serve(referenceProvider({ root: deviceRoot }));
  try {
    const remote = await createHttpProofProvider({ endpoint: server.url, ...as("operator") })
      .produce({ root: deviceRoot, query: deviceQuery, bundles: [deviceBundle] });
    const local = await createLocalProofProvider({ authenticate: authenticateArchon })
      .produce({ root: deviceRoot, query: deviceQuery, bundles: [deviceBundle] });
    const verifier = createSpacesVerifier({ root: deviceRoot, authenticate: authenticateArchon });
    for (const proof of [remote.proof, local.proof]) assert.equal(verifier.verify({ query: deviceQuery, proof }).permitted, true);
    const changed = { ...deviceQuery, statement: fact("temperature", atom("device7"), encodeInt(99n)) };
    assert.equal(verifier.verify({ query: changed, proof: remote.proof }).permitted, false);
    assert.equal(docsVerifier.verify({ query: deviceQuery, proof: remote.proof }).permitted, false);
  } finally { await server.close(); }
});

test("tampered evidence, mismatched proofs and untyped responses keep their distinctions", async () => {
  const tampered = { ...publicBundle, payload: flipLast(publicBundle.payload) };
  const otherRoot = key(71);
  let mode = "honest";
  const server = await serve(url => async (call, request) => {
    if (mode === "other-query") {
      return answerProofRequest({ ...request, query: { ...request.query, actor: carol } }, { authenticate: null });
    }
    if (mode === "other-root") return answerProofRequest({ ...request, root: otherRoot }, { authenticate: null });
    if (mode === "tampered-proof") {
      const result = await answerProofRequest(request, { authenticate: null });
      if (result.kind !== "proof") return result;
      const proof = decodeProof(result.proof);
      const bundle = proof.bundles[0]!;
      return { kind: "proof", observations: [],
        proof: encodeProof({ ...proof, bundles: [{ ...bundle, payload: flipLast(bundle.payload) }, ...proof.bundles.slice(1)] }) };
    }
    if (mode === "garbage") return { raw: { status: 200, type: proofMediaType, body: new Uint8Array([0xff, 0x00]) } };
    if (mode === "503") return { raw: { status: 503, type: "text/plain", body: new TextEncoder().encode("busy") } };
    if (mode === "401") return { raw: { status: 401, type: "text/plain", body: new Uint8Array() } };
    if (mode === "403") return { raw: { status: 403, type: "text/html", body: new TextEncoder().encode("denied") } };
    if (mode === "long-detail") return { kind: "failure", code: "evidence_unavailable", detail: "\u{1F600}".repeat(600) };
    if (mode === "chunked") return { raw: { status: 200, type: proofMediaType, body: new Uint8Array(4096), chunked: true } };
    return referenceProvider({ root: docsRoot })(url)(call, request);
  });
  try {
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    const readBob = { root: docsRoot, query: readQuery(bob), bundles: [publicBundle] };
    await assert.rejects(client.produce({ ...readBob, bundles: [tampered] }), failsWith("invalid_request"));
    const badSignature = { ...publicBundle, authentication: new Atom(flipLast((publicBundle.authentication as Atom).bytes())) };
    await assert.rejects(client.produce({ ...readBob, bundles: [badSignature] }),
      (error: unknown) => failsWith("invalid_request")(error) && (error as ProofProviderError).detail === "a supplied bundle did not authenticate");
    mode = "other-query";
    await assert.rejects(client.produce({ root: docsRoot, query: readQuery(bob),
      bundles: [signSpaceFacts({ supplier: docsRoot, space: path(), assertedAt: time, clauses: [
        attributedClause(docsRoot, path(), authorization(carol, readRecords, team))] }, seed(51))] }), failsWith("invalid_response"));
    mode = "other-root";
    await assert.rejects(client.produce({ root: docsRoot, query: { actor: otherRoot, statement: fact("op"), space: path("x") } }),
      failsWith("invalid_response"));
    mode = "tampered-proof";
    const altered = await client.produce(readBob);
    const verdict = docsVerifier.verify({ query: readBob.query, proof: altered.proof });
    assert.equal(verdict.permitted, false);
    assert.ok(["authentication-failed", "invalid-proof"].includes(verdict.code), verdict.code);
    mode = "garbage";
    await assert.rejects(client.produce(readBob), failsWith("invalid_response"));
    mode = "503";
    await assert.rejects(client.produce(readBob), failsWith("provider_unavailable"));
    mode = "401";
    await assert.rejects(client.produce(readBob), failsWith("unauthenticated"));
    // An untyped 403 is a refusal, not evidence of an authentication failure or a disclosure decision.
    mode = "403";
    await assert.rejects(client.produce(readBob), failsWith("provider_refused"));
    mode = "long-detail";
    await assert.rejects(client.produce(readBob), (error: unknown) => {
      if (!(error instanceof ProofProviderError) || error.code !== "evidence_unavailable") return false;
      const points = Array.from(error.detail!);
      assert.equal(points.length, 513);
      assert.equal(points[511], "\u{1F600}");
      encodeProofResult({ kind: "failure", code: error.code, detail: error.detail! });
      return true;
    });
    mode = "chunked";
    await assert.rejects(createHttpProofProvider({ endpoint: server.url, ...as("bob"), maxResponseBytes: 64 }).produce(readBob),
      failsWith("limit_exceeded"));
  } finally { await server.close(); }
});

test("search outcomes, provider ceilings and deadlines stay distinct from refusal", async () => {
  const server = await docsProvider();
  try {
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    const read = await client.produce({ root: docsRoot, query: readQuery(bob), bundles: [publicBundle] });
    const target = { root: docsRoot, query: renameQuery, bundles: [publicBundle], selection: placements(team),
      disclosureProofs: [read.proof] };
    await assert.rejects(client.produce({ ...target, budget: { searchNodes: 1 } }), failsWith("not_completed"));
    await assert.rejects(client.produce({ ...target, query: { ...renameQuery, actor: carol } }), failsWith("exhausted"));
    // A provider ceiling holds even when the request asks for more.
    const local = (options: { ceilings?: { searchNodes?: number; deadlineMs?: number } }) =>
      createLocalProofProvider({ bundles: [teamRecords], authenticate: authenticateArchon, ...options });
    await assert.rejects(local({ ceilings: { searchNodes: 1 } }).produce({ root: docsRoot, query: renameQuery,
      bundles: [publicBundle], budget: { searchNodes: 1_000_000 } }), failsWith("not_completed"));
    // A deadline counts from receipt: time already spent leaves less, or none, for search.
    const timed = (elapsedMs: number, deadlineMs: number) => answerProofRequest({ root: docsRoot, query: renameQuery,
      bundles: [publicBundle], budget: { deadlineMs } }, { authenticate: authenticateArchon, bundles: [teamRecords], elapsedMs });
    assert.deepEqual(await timed(1000, 500), { kind: "failure", code: "not_completed", detail: "the deadline passed before search" });
    assert.equal((await timed(1 / 3, 60_000)).kind, "proof");
    assert.equal((await timed(12.3456789, 60_000)).kind, "proof");
    await assert.rejects(timed(Number.NaN, 60_000), TypeError);
    await assert.rejects(timed(-5, 60_000), TypeError);
    await assert.rejects(answerProofRequest({ root: docsRoot, query: renameQuery, bundles: [publicBundle] },
      { authenticate: authenticateArchon, ceilings: { searchNodes: 1000.5 } }), TypeError);
    assert.deepEqual(await answerProofRequest({ root: docsRoot, query: renameQuery, bundles: [publicBundle],
      budget: { memoryBytes: 1.5 } }, { authenticate: authenticateArchon }),
      { kind: "failure", code: "invalid_request", detail: "budget hints must be whole, non-negative numbers" });
    // Per-request values never come from construction, even through an untyped options object.
    const loose = { bundles: [teamRecords], authenticate: authenticateArchon, elapsedMs: 1000 } as Parameters<typeof createLocalProofProvider>[0];
    assert.equal(docsVerifier.verify({ query: renameQuery, proof: (await createLocalProofProvider(loose)
      .produce({ root: docsRoot, query: renameQuery, bundles: [publicBundle], budget: { deadlineMs: 500 } })).proof }).permitted, true);
    await assert.rejects(answerProofRequest({ root: docsRoot, query: renameQuery },
      { authenticate: null, bundles: [{ payload: new Uint8Array([1, 2, 3]), authentication: atom("x") }] }),
      (error: unknown) => error instanceof Error && !(error instanceof ProofProviderError));
    assert.throws(() => createLocalProofProvider({} as unknown as Parameters<typeof createLocalProofProvider>[0]), TypeError);
    // The provider helper refuses to run without an explicit authentication choice.
    await assert.rejects(answerProofRequest({ root: docsRoot, query: renameQuery },
      {} as unknown as Parameters<typeof answerProofRequest>[1]), TypeError);
  } finally { await server.close(); }
});

test("caller faults in supplied evidence keep their own codes", async () => {
  const oversized = signSpaceFacts({ supplier: docsRoot, space: path(), assertedAt: encodeText("x".repeat(1_100_000)),
    clauses: [attributedClause(docsRoot, path(), authorization(bob, readRecords, team))] }, seed(51));
  assert.deepEqual(await answerProofRequest({ root: docsRoot, query: readQuery(bob), bundles: [oversized] },
    { authenticate: authenticateArchon }),
    { kind: "failure", code: "limit_exceeded", detail: "a supplied bundle exceeds the bundle size limit" });
  const [badRule] = (await loadSearcher()).parseProgram("authorized(P, x, []) :- foo(P).").clauses;
  const badClause = signSpaceFacts({ supplier: docsRoot, space: path(), assertedAt: time,
    clauses: [attributedClause(docsRoot, path(), badRule!)] }, seed(51));
  assert.deepEqual(await answerProofRequest({ root: docsRoot, query: readQuery(bob), bundles: [badClause] },
    { authenticate: authenticateArchon }),
    { kind: "failure", code: "invalid_request", detail: "a supplied clause is malformed" });
});

test("a proof over the protocol's size limit is limit_exceeded, not a thrown error", async () => {
  const padded = encodeText("x".repeat(600_000));
  const bundles = [
    signSpaceFacts({ supplier: docsRoot, space: path(), assertedAt: padded, clauses: [
      attributedClause(docsRoot, path(), authorization(teamAsserter, atom("supply_facts"), team))] }, seed(51)),
    signSpaceFacts({ supplier: teamAsserter, space: team, assertedAt: padded, clauses: [
      attributedClause(docsRoot, team, authorization(bob, rename, team))] }, seed(52)),
  ];
  assert.deepEqual(await answerProofRequest({ root: docsRoot, query: renameQuery, bundles }, { authenticate: authenticateArchon }),
    { kind: "failure", code: "limit_exceeded", detail: "the proof exceeds the protocol's proof limits" });
});

test("request and response bounds and caller cancellation are enforced", async () => {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let slow = false;
  const server = await serve(url => async (call, request) => {
    if (slow) await held;
    return referenceProvider({ root: docsRoot })(url)(call, request);
  });
  try {
    const request = { root: docsRoot, query: readQuery(bob), bundles: [publicBundle] };
    const before = server.requests;
    await assert.rejects(createHttpProofProvider({ endpoint: server.url, ...as("bob"), maxRequestBytes: 64 }).produce(request),
      failsWith("limit_exceeded"));
    assert.equal(server.requests, before);
    await assert.rejects(createHttpProofProvider({ endpoint: server.url, ...as("bob"), maxResponseBytes: 64 }).produce(request),
      failsWith("limit_exceeded"));
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    const reason = new Error("the caller stopped");
    await assert.rejects(client.produce(request, AbortSignal.abort(reason)), (error: unknown) => error === reason);
    await assert.rejects(createLocalProofProvider({ authenticate: authenticateArchon }).produce(request, AbortSignal.abort(reason)),
      (error: unknown) => error === reason);
    slow = true;
    const controller = new AbortController();
    const pending = client.produce(request, controller.signal);
    setTimeout(() => controller.abort(reason), 50);
    await assert.rejects(pending, (error: unknown) => error === reason);
    // The adapter's own wait bound is a provider failure, distinct from the caller's cancellation.
    await assert.rejects(createHttpProofProvider({ endpoint: server.url, ...as("bob"), timeoutMs: 100 }).produce(request),
      failsWith("provider_unavailable"));
    assert.throws(() => createHttpProofProvider({ endpoint: server.url, timeoutMs: 0 }), TypeError);
    assert.throws(() => createHttpProofProvider({ endpoint: server.url, maxRequestBytes: Number.NaN }), TypeError);
    assert.throws(() => createHttpProofProvider({ endpoint: server.url, timeoutMs: 2 ** 31 }), TypeError);
  } finally {
    release();
    await server.close();
  }
});
