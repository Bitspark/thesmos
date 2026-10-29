import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { getPublicKey } from "@bitspark/archon";
import { Atom, type Value } from "@bitspark/logos-contract";
import { encodeInt, encodeText, readText } from "@bitspark/ontos-data";
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

// Synthetic keys and vocabulary. The reference provider stands in for any hosting service.
const seed = (n: number) => new Uint8Array(32).fill(n);
const key = (n: number) => new Atom(getPublicKey(seed(n)));
const time = encodeInt(1792540800n);

// Vocabulary 1: documents. Bob may read the "docs" records and, per those records, rename doc7.
const docsRoot = key(51), teamAsserter = key(52);
const team = path("team"), docs = path("team", "docs");
const bob = atom("bob"), carol = atom("carol");
const rename = fact("title", atom("doc7"), encodeText("Reconciled model"));
const readDocs = fact("read_records", atom("docs"));
const publicBundle = signSpaceFacts({ supplier: docsRoot, space: path(), assertedAt: time, clauses: [
  attributedClause(docsRoot, path(), authorization(teamAsserter, atom("supply_facts"), team)),
  attributedClause(docsRoot, path(), authorization(bob, readDocs, team)),
] }, seed(51));
const docsRecords = signSpaceFacts({ supplier: teamAsserter, space: team, assertedAt: time, clauses: [
  attributedClause(docsRoot, team, authorization(bob, rename, team)),
] }, seed(52));
const renameQuery = { actor: bob, statement: rename, space: docs };
const docsVerifier = createSpacesVerifier({ root: docsRoot, authenticate: authenticateArchon });

// Vocabulary 2: devices, under an unrelated root and a separately configured provider.
const deviceRoot = key(61), technician = atom("technician"), devices = path("devices");
const temperature = fact("temperature", atom("device7"), encodeInt(21n));
const deviceBundle = signSpaceFacts({ supplier: deviceRoot, space: devices, assertedAt: time, clauses: [
  attributedClause(deviceRoot, devices, authorization(technician, temperature, devices)),
] }, seed(61));
const deviceQuery = { actor: technician, statement: temperature, space: devices };

type Raw = { readonly raw: { readonly status: number; readonly type: string; readonly body: Uint8Array } };
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
    try {
      const request = decodeProofRequest(new Uint8Array(Buffer.concat(chunks)));
      out = await handler({ ...(typeof caller === "string" ? { caller: atom(caller) } : {}),
        ...(typeof audience === "string" ? { audience } : {}) }, request);
    } catch {
      out = { kind: "failure", code: "invalid_request" };
    }
    if ("raw" in out) {
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

/** A reference provider: authenticated caller, audience, disclosure by the caller's own proof. */
function referenceProvider(config: {
  readonly root: Value; readonly disclosureSpace: Value;
  readonly selections?: ReadonlyMap<string, readonly SpaceFactsBundle[]>;
  readonly unavailable?: ReadonlySet<string>;
}) {
  const verifier = createSpacesVerifier({ root: config.root, authenticate: authenticateArchon });
  return (url: string): Handler => async (call, request) => {
    if (call.audience !== url || call.caller === undefined) return { kind: "failure", code: "unauthenticated" };
    let selected: readonly SpaceFactsBundle[] = [];
    const observations = [];
    if (request.selection !== undefined) {
      const name = readText(request.selection);
      if (config.unavailable?.has(name)) return { kind: "failure", code: "evidence_unavailable", detail: "source unavailable" };
      const records = config.selections?.get(name);
      if (!records) return { kind: "failure", code: "evidence_unavailable", detail: "unknown selection" };
      // The disclosure query names the AUTHENTICATED caller, never the request's queried actor.
      const query = { actor: call.caller, statement: fact("read_records", atom(name)), space: config.disclosureSpace };
      if (!(request.disclosureProofs ?? []).some(proof => verifier.verify({ query, proof }).permitted)) {
        return { kind: "failure", code: "disclosure_refused" };
      }
      selected = records;
      observations.push({ source: atom("reference-records"), position: encodeInt(7n) });
    }
    return answerProofRequest(request, { bundles: selected, authenticate: authenticateArchon, observations });
  };
}

const as = (caller: string, audience?: string) => ({
  authenticate: ({ headers, url }: OutgoingProofRequest) => {
    headers.set("x-test-caller", caller);
    headers.set("x-test-audience", audience ?? url.href);
  },
});
const flipLast = (bytes: Uint8Array) => { const out = Uint8Array.from(bytes); out[out.length - 1]! ^= 1; return out; };
const failsWith = (code: ProofProviderFailure) => (error: unknown) =>
  error instanceof ProofProviderError && error.code === code;
const docsProvider = () => serve(referenceProvider({
  root: docsRoot, disclosureSpace: team,
  selections: new Map([["docs", [docsRecords]]]), unavailable: new Set(["archive"]),
}));

test("proof request and result codecs round-trip and refuse malformed input", () => {
  const request: ProofRequest = {
    root: docsRoot, query: renameQuery, bundles: [publicBundle], selection: encodeText("docs"),
    disclosureProofs: [new Uint8Array([1, 2, 3])], budget: { deadlineMs: 5000, searchNodes: 100 },
  };
  const decoded = decodeProofRequest(encodeProofRequest(request));
  assert.equal(decoded.root.equals(docsRoot), true);
  assert.equal(decoded.query.statement.equals(rename), true);
  assert.deepEqual(decoded.bundles![0]!.payload, publicBundle.payload);
  assert.equal(decoded.bundles![0]!.authentication.equals(publicBundle.authentication), true);
  assert.equal(readText(decoded.selection!), "docs");
  assert.deepEqual(decoded.disclosureProofs, [new Uint8Array([1, 2, 3])]);
  assert.deepEqual(decoded.budget, { deadlineMs: 5000, searchNodes: 100 });
  const minimal = decodeProofRequest(encodeProofRequest({ root: docsRoot, query: renameQuery }));
  assert.equal(minimal.selection, undefined);
  assert.deepEqual(minimal.budget, {});

  const proofResult = decodeProofResult(encodeProofResult({ kind: "proof", proof: new Uint8Array([9]),
    observations: [{ source: atom("s"), position: encodeInt(3n) }] }));
  assert.equal(proofResult.kind, "proof");
  assert.deepEqual(decodeProofResult(encodeProofResult({ kind: "failure", code: "disclosure_refused", detail: "no" })),
    { kind: "failure", code: "disclosure_refused", detail: "no" });

  assert.throws(() => encodeProofRequest({ ...request, budget: { searchNodes: -1 } }), TypeError);
  assert.throws(() => decodeProofRequest(encodeProofRequest(request), 16), RangeError);
  assert.throws(() => decodeProofRequest(encodeProofResult({ kind: "failure", code: "exhausted" })), TypeError);
  assert.throws(() => encodeProofResult({ kind: "failure", code: "permitted" as ProofProviderFailure }), TypeError);
});

test("two-stage disclosure works remotely, with no local search, and matches local production", async () => {
  const server = await docsProvider();
  try {
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    // Stage 1: the read right comes from supplied public evidence alone.
    const read = await client.produce({ root: docsRoot, query: { actor: bob, statement: readDocs, space: team },
      bundles: [publicBundle] });
    assert.equal(docsVerifier.verify({ query: { actor: bob, statement: readDocs, space: team }, proof: read.proof }).permitted, true);
    // Stage 2: that proof discloses the private records for the actual operation's proof.
    const remote = await client.produce({ root: docsRoot, query: renameQuery, bundles: [publicBundle],
      selection: encodeText("docs"), disclosureProofs: [read.proof] });
    assert.equal(docsVerifier.verify({ query: renameQuery, proof: remote.proof }).permitted, true);
    assert.equal(remote.observations.length, 1);
    const carried = decodeProof(remote.proof).bundles.map(bundle => Buffer.from(bundle.payload).toString("hex"));
    for (const payload of carried) {
      assert.ok([publicBundle, docsRecords].some(b => Buffer.from(b.payload).toString("hex") === payload));
    }
    // The same inputs produced locally yield a proof of the same exact query.
    const local = await createLocalProofProvider({ bundles: [docsRecords] })
      .produce({ root: docsRoot, query: renameQuery, bundles: [publicBundle] });
    assert.equal(docsVerifier.verify({ query: renameQuery, proof: local.proof }).permitted, true);
    assert.equal(docsVerifier.verify({ query: { ...renameQuery, actor: carol }, proof: remote.proof }).permitted, false);
  } finally { await server.close(); }
});

test("caller authentication, disclosure authority and caller/actor confusion are refused", async () => {
  const server = await docsProvider();
  try {
    const target = { root: docsRoot, query: renameQuery, bundles: [publicBundle], selection: encodeText("docs") };
    const bobRead = await createHttpProofProvider({ endpoint: server.url, ...as("bob") }).produce({
      root: docsRoot, query: { actor: bob, statement: readDocs, space: team }, bundles: [publicBundle] });
    // Wrong audience, and no caller authentication at all.
    await assert.rejects(createHttpProofProvider({ endpoint: server.url, ...as("bob", "https://elsewhere.example/") })
      .produce({ ...target, disclosureProofs: [bobRead.proof] }), failsWith("unauthenticated"));
    await assert.rejects(createHttpProofProvider({ endpoint: server.url })
      .produce({ ...target, disclosureProofs: [bobRead.proof] }), failsWith("unauthenticated"));
    const asCarol = createHttpProofProvider({ endpoint: server.url, ...as("carol") });
    // Carol holds no read right: her own read proof cannot be produced, and nothing is disclosed.
    await assert.rejects(asCarol.produce({ root: docsRoot, query: { actor: carol, statement: readDocs, space: team },
      bundles: [publicBundle] }), failsWith("exhausted"));
    await assert.rejects(asCarol.produce(target), failsWith("disclosure_refused"));
    // Bob's read proof does not authorize Carol: disclosure is decided for the caller, not the actor.
    await assert.rejects(asCarol.produce({ ...target, disclosureProofs: [bobRead.proof] }), failsWith("disclosure_refused"));
    // The queried actor is a goal term: Carol may obtain a proof about Bob from public evidence.
    const aboutBob = await asCarol.produce({ root: docsRoot, query: { actor: bob, statement: readDocs, space: team },
      bundles: [publicBundle] });
    assert.equal(docsVerifier.verify({ query: { actor: bob, statement: readDocs, space: team }, proof: aboutBob.proof }).permitted, true);
    // Unavailable and unknown sources are distinct from refusal.
    const asBob = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    await assert.rejects(asBob.produce({ ...target, selection: encodeText("archive"), disclosureProofs: [bobRead.proof] }),
      failsWith("evidence_unavailable"));
    await assert.rejects(asBob.produce({ ...target, selection: encodeText("missing"), disclosureProofs: [bobRead.proof] }),
      failsWith("evidence_unavailable"));
  } finally { await server.close(); }
});

test("a second vocabulary and a separately configured provider use the same contract", async () => {
  const server = await serve(referenceProvider({ root: deviceRoot, disclosureSpace: devices }));
  try {
    const remote = await createHttpProofProvider({ endpoint: server.url, ...as("operator") })
      .produce({ root: deviceRoot, query: deviceQuery, bundles: [deviceBundle] });
    const local = await createLocalProofProvider().produce({ root: deviceRoot, query: deviceQuery, bundles: [deviceBundle] });
    const verifier = createSpacesVerifier({ root: deviceRoot, authenticate: authenticateArchon });
    for (const proof of [remote.proof, local.proof]) assert.equal(verifier.verify({ query: deviceQuery, proof }).permitted, true);
    const changed = { ...deviceQuery, statement: fact("temperature", atom("device7"), encodeInt(99n)) };
    assert.equal(verifier.verify({ query: changed, proof: remote.proof }).permitted, false);
    assert.equal(docsVerifier.verify({ query: deviceQuery, proof: remote.proof }).permitted, false);
  } finally { await server.close(); }
});

test("tampered evidence, mismatched proofs and malformed responses keep their distinctions", async () => {
  const tampered = { ...publicBundle, payload: flipLast(publicBundle.payload) };
  const otherRoot = key(71);
  let mode = "honest";
  const server = await serve(url => async (call, request) => {
    if (mode === "other-query") {
      return answerProofRequest({ ...request, query: { ...request.query, actor: carol } }, { bundles: [] });
    }
    if (mode === "other-root") return answerProofRequest({ ...request, root: otherRoot });
    if (mode === "tampered-proof") {
      const result = await answerProofRequest(request);
      if (result.kind !== "proof") return result;
      const proof = decodeProof(result.proof);
      const bundle = proof.bundles[0]!;
      const altered = flipLast(bundle.payload);
      return { kind: "proof", proof: encodeProof({ ...proof, bundles: [{ ...bundle, payload: altered }, ...proof.bundles.slice(1)] }),
        observations: [] };
    }
    if (mode === "garbage") return { raw: { status: 200, type: proofMediaType, body: new Uint8Array([0xff, 0x00]) } };
    if (mode === "503") return { raw: { status: 503, type: "text/plain", body: new TextEncoder().encode("busy") } };
    if (mode === "401") return { raw: { status: 401, type: "text/plain", body: new Uint8Array() } };
    return referenceProvider({ root: docsRoot, disclosureSpace: team })(url)(call, request);
  });
  try {
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    const readBob = { root: docsRoot, query: { actor: bob, statement: readDocs, space: team }, bundles: [publicBundle] };
    await assert.rejects(client.produce({ ...readBob, bundles: [tampered] }), failsWith("invalid_request"));
    mode = "other-query";
    await assert.rejects(client.produce({ root: docsRoot, query: { actor: bob, statement: readDocs, space: team },
      bundles: [signSpaceFacts({ supplier: docsRoot, space: path(), assertedAt: time, clauses: [
        attributedClause(docsRoot, path(), authorization(carol, readDocs, team))] }, seed(51))] }), failsWith("invalid_response"));
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
  } finally { await server.close(); }
});

test("search outcomes and provider ceilings stay distinct from refusal", async () => {
  const server = await docsProvider();
  try {
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    const read = await client.produce({ root: docsRoot, query: { actor: bob, statement: readDocs, space: team },
      bundles: [publicBundle] });
    const target = { root: docsRoot, query: renameQuery, bundles: [publicBundle], selection: encodeText("docs"),
      disclosureProofs: [read.proof] };
    await assert.rejects(client.produce({ ...target, budget: { searchNodes: 1 } }), failsWith("not_completed"));
    await assert.rejects(client.produce({ ...target, query: { ...renameQuery, actor: carol } }), failsWith("exhausted"));
    // A provider ceiling holds even when the request asks for more.
    const capped = createLocalProofProvider({ bundles: [docsRecords], ceilings: { searchNodes: 1 } });
    await assert.rejects(capped.produce({ root: docsRoot, query: renameQuery, bundles: [publicBundle],
      budget: { searchNodes: 1_000_000 } }), failsWith("not_completed"));
  } finally { await server.close(); }
});

test("request and response bounds and caller cancellation are enforced", async () => {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let slow = false;
  const server = await serve(url => async (call, request) => {
    if (slow) await held;
    return referenceProvider({ root: docsRoot, disclosureSpace: team })(url)(call, request);
  });
  try {
    const request = { root: docsRoot, query: { actor: bob, statement: readDocs, space: team }, bundles: [publicBundle] };
    const before = server.requests;
    await assert.rejects(createHttpProofProvider({ endpoint: server.url, ...as("bob"), maxRequestBytes: 64 }).produce(request),
      failsWith("limit_exceeded"));
    assert.equal(server.requests, before);
    await assert.rejects(createHttpProofProvider({ endpoint: server.url, ...as("bob"), maxResponseBytes: 64 }).produce(request),
      failsWith("limit_exceeded"));
    const client = createHttpProofProvider({ endpoint: server.url, ...as("bob") });
    await assert.rejects(client.produce(request, AbortSignal.abort()), { name: "AbortError" });
    slow = true;
    const controller = new AbortController();
    const pending = client.produce(request, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, { name: "AbortError" });
  } finally {
    release();
    await server.close();
  }
});
