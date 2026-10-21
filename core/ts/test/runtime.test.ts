import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getPublicKey } from "@bitspark/archon";
import { Atom, Clause, DERIVATION_WIRE_V1_TAG, Goal, Term, Tuple, VarId, clauseFromValue, clauseValue, derivationWirePayloadV1ToValue, programBytes } from "@bitspark/logos-contract";
import { decode, encode } from "@bitspark/ontos-codec";
import { encodeInt } from "@bitspark/ontos-data";
import { atom, authorization, attributedClause, createSpacesVerifier, decodeProof, fact, path } from "../src/index.js";
import { authenticateArchon, signSpaceFacts } from "../src/archon.js";
import { createSpacesRuntime, instantiateSpacesObservations, portableEnvelopeReserve, prepareSpacesOverlay, prepareSpacesProgram, PreparationRefused, SpacesWitness } from "../src/runtime.js";
import { lawDigest, layerDigest, protocol } from "../src/data.js";
import { ProofBuilder } from "./recipes.js";

const seed = new Uint8Array(32).fill(71), observerSeed = new Uint8Array(32).fill(72);
const root = new Atom(getPublicKey(seed)), observer = new Atom(getPublicKey(observerSeed));
const actor = atom("synthetic-actor"), service = path("synthetic-service"), observations = path("synthetic-requests");
const budget = { maxBundles: 100, maxClauses: 5000, maxPayloadBytes: 8 * 1024 * 1024 };
const sign = (clauses: readonly Clause[], key = seed, placement = path(), time = 0n) => {
  const supplier = new Atom(getPublicKey(key));
  return signSpaceFacts({ supplier, space: placement, assertedAt: encodeInt(time), clauses }, key);
};
const variable = Term.var("Request");
const observedPath = Term.tuple([Term.fromValue(atom(".")), Term.fromValue(atom("synthetic-requests")),
  Term.tuple([Term.fromValue(atom(".")), variable, Term.fromValue(atom("[]"))])]);
const conditional = new Clause(Goal.of("authorized", [Term.fromValue(actor),
  Term.tuple([Term.fromValue(atom("perform")), variable]), Term.fromValue(service)]), [
  Goal.of("counts", [Term.fromValue(observer), observedPath, Term.fromValue(atom("observed"))]),
]);
const base = (includeObservationAuthority = true) => [sign([
  attributedClause(root, path(), authorization(observer, atom("supply_facts"), observations)),
  ...(includeObservationAuthority ? [attributedClause(root, path(), authorization(observer, atom("observed"), observations))] : []),
  attributedClause(root, path(), conditional),
])];
const query = (nonce: string) => ({ actor, statement: fact("perform", atom(nonce)), space: service });
const observation = (nonce: string) => {
  const placement = path("synthetic-requests", nonce);
  return sign([attributedClause(observer, placement, atom("observed"))], observerSeed, placement);
};
const A = Term.var("Author"), P = Term.var("Placement"), S = Term.var("Supplier"), H = Term.fromValue(atom("observed"));
const templates = [{ name: "signed-observed", parameters: [VarId.of("Author"), VarId.of("Placement"), VarId.of("Supplier")],
  clause: new Clause(Goal.of("counts", [A, P, H]), [Goal.of("authorized", [A, H, P]),
    Goal.of("authorized", [S, Term.fromValue(atom("supply_facts")), P])]) }];

test("preparation authenticates copies and retains distinct whole source identities", () => {
  const one = observation("one"), two = sign([attributedClause(observer, path("synthetic-requests", "one"), atom("observed"))],
    observerSeed, path("synthetic-requests", "one"), 1n);
  const prepared = prepareSpacesOverlay({ bundles: [one, two], budget, authenticate: request => {
    const accepted = authenticateArchon(request); request.payload.fill(0);
    if (request.supplier instanceof Atom) request.supplier.bytes().fill(0);
    return accepted;
  } });
  assert.equal(prepared.clauseCount, 2);
  assert.equal(new Set(prepared.sourceCosts().map(source => source.group)).size, 2);
  assert.deepEqual(prepared.selectedBundles()[0]!.payload, one.payload);
  one.payload.fill(0);
  assert(prepared.selectedBundles()[0]!.payload.some(byte => byte !== 0));
  for (const [, clause] of prepared.nativeProgram().entries()) {
    assert.equal(clause.body.length, 2);
    assert(clause.body.every(premise => premise.isPos() && premise.lit.pred.equals(Goal.of("authorized", []).pred)));
  }
  assert.equal(instantiateSpacesObservations(prepared, templates).length, 2);
  assert.throws(() => instantiateSpacesObservations(prepared, []), PreparationRefused);
  const captured = programBytes(prepared.nativeProgram());
  const [id, outward] = prepared.nativeProgram().entries()[0]!;
  const author = outward.head.args[0]!;
  assert.equal(author.kind, "atom");
  if (author.kind === "atom") author.bytes().fill(0);
  const outwardClause = prepared.clause(id)!;
  const nextAuthor = outwardClause.head.args[0]!;
  if (nextAuthor.kind === "atom") nextAuthor.bytes().fill(0);
  assert.deepEqual(programBytes(prepared.nativeProgram()), captured);
});

test("the calculated envelope reserve bounds actual codec bytes at varint boundaries", () => {
  const bundle = new Tuple([new Atom(new Uint8Array([1, 2, 3])), atom("authentication")]);
  const sourceBytes = encode(bundle).byteLength;
  for (const groups of [0, 127, 128, 2048]) for (const bytes of [0, 127, 128, 16383, 16384, 1048576]) {
    // A valid codec payload is sufficient for the length boundary; the next
    // case checks a real independently accepted derivation without source IDs.
    const payload = new Atom(new Uint8Array(bytes));
    const payloadBytes = encode(payload).byteLength;
    const wire = encode(new Tuple([atom(DERIVATION_WIRE_V1_TAG), payload]));
    const envelope = encode(new Tuple([atom(protocol.format), lawDigest, layerDigest,
      new Tuple(Array(groups).fill(bundle)), new Atom(wire)]));
    assert(envelope.byteLength <= sourceBytes * groups + payloadBytes + portableEnvelopeReserve(payloadBytes, groups));
  }
});

test("a real law-only proof fits the payload charge and complete wire reserve", () => {
  const query = { actor: root, statement: atom("synthetic-action"), space: service };
  const builder = new ProofBuilder();
  const conclusion = builder.apply("root-authority", { R: root, F: query.statement, S: query.space }, [builder.anchor(root)]);
  const proof = builder.finish(conclusion), decoded = decodeProof(proof);
  assert.equal(decoded.bundles.length, 0);
  assert.equal(createSpacesVerifier({ root, authenticate: authenticateArchon }).verify({ query, proof }).permitted, true);
  const payloadBytes = encode(derivationWirePayloadV1ToValue(decoded.derivation)).byteLength;
  // There are no attributed source IDs to shorten and hide missing overhead.
  assert.equal(payloadBytes + portableEnvelopeReserve(payloadBytes, 0), proof.byteLength);
  assert(payloadBytes + portableEnvelopeReserve(proof.byteLength, 0) >= proof.byteLength);
});

test("acquisition is independent of the portable clause limit and remains bounded", () => {
  const clauses = Array.from({ length: 64 }, (_, i) => attributedClause(root, path(), fact("synthetic", atom(String(i)))));
  const bundles = Array.from({ length: 33 }, (_, i) => sign(clauses, seed, path(), BigInt(i)));
  const prepared = prepareSpacesProgram({ bundles, authenticate: authenticateArchon, budget });
  assert.equal(prepared.clauseCount, 2112);
  assert.throws(() => prepareSpacesProgram({ bundles, authenticate: authenticateArchon, budget: { ...budget, maxClauses: 2048 } }),
    (error: unknown) => error instanceof PreparationRefused && error.code === "budget");
  assert.throws(() => prepareSpacesProgram({ bundles: [bundles[0]!], authenticate: () => false, budget }),
    (error: unknown) => error instanceof PreparationRefused && error.code === "authentication");
});

test("guarded observations isolate requests; retained proof survives replacement and retirement", async () => {
  const runtime = await createSpacesRuntime({ root, bundles: base(), authenticate: authenticateArchon,
    preparationBudget: budget, observationTemplates: templates });
  const first = await runtime.decide({ query: query("one"), observations: [observation("one")] });
  assert.equal(first.kind, "permitted", first.kind === "unsupported" ? first.detail : undefined);
  if (first.kind !== "permitted") return;
  try {
    const absent = await runtime.decide({ query: query("two"), observations: [observation("one")] });
    assert.equal(absent.kind, "forbidden", absent.kind === "unsupported" ? absent.detail : undefined);
    await runtime.replace(base(false));
    const guarded = await runtime.decide({ query: query("one"), observations: [observation("one")] });
    assert.equal(guarded.kind, "forbidden", guarded.kind === "unsupported" ? guarded.detail : undefined);
    runtime.close();
    const exported = await first.witness.export();
    assert.equal(exported.kind, "exported");
    if (exported.kind !== "exported") return;
    const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
    assert.equal(verifier.verify({ query: query("one"), proof: exported.proof }).permitted, true);
    assert.equal(verifier.verify({ query: query("two"), proof: exported.proof }).permitted, false);
    const tiny = await first.witness.export({ maxBytes: 1 });
    assert.equal(tiny.kind, "unavailable");
  } finally { first.witness.close(); runtime.close(); }
});

test("required portable selection preserves a small eligible alternative", async () => {
  const request = { actor, statement: atom("synthetic-action"), space: service };
  const granting = attributedClause(root, path(), authorization(actor, request.statement, service));
  const large = sign([granting, ...Array.from({ length: 8 }, (_, i) => attributedClause(root, path(), fact("irrelevant", atom(String(i)))))]);
  const small = sign([granting], seed, path(), 1n);
  const runtime = await createSpacesRuntime({ root, bundles: [large, small], authenticate: authenticateArchon, preparationBudget: budget });
  try {
    const result = await runtime.decide({ query: request, observations: [], portable: "required", carryingBudget: { maxClauses: 1 } });
    assert.equal(result.kind, "permitted", result.kind === "unsupported" ? result.detail : undefined);
    if (result.kind !== "permitted") return;
    try {
      assert(result.proof);
      const carried = decodeProof(result.proof).bundles;
      assert.equal(carried.length, 1);
      assert.deepEqual(carried[0]!.payload, small.payload);
    } finally { result.witness.close(); }
    const limited = await runtime.decide({ query: request, observations: [], portable: "required", carryingBudget: { maxClauses: 1, maxSteps: 1 } });
    assert.equal(limited.kind, "unsupported");
  } finally { runtime.close(); }
});

test("root, query and declared fragment byte mutation cannot rewrite a prepared interpretation", async () => {
  const mutableRoot = new Atom(getPublicKey(seed));
  const mutableTemplates = templates.map(template => ({ ...template, clause: clauseFromValue(decode(encode(clauseValue(template.clause))))! }));
  const runtime = await createSpacesRuntime({ root: mutableRoot, bundles: base(), authenticate: authenticateArchon,
    preparationBudget: budget, observationTemplates: mutableTemplates });
  try {
    mutableRoot.bytes().fill(0);
    const statement = mutableTemplates[0]!.clause.head.args[2]!;
    if (statement.kind === "atom") statement.bytes().fill(0);
    const mutableQuery = query("captured");
    const pending = runtime.decide({ query: mutableQuery, observations: [observation("captured")] });
    ((mutableQuery.statement as Tuple).at(1) as Atom).bytes().fill(0);
    const result = await pending;
    assert.equal(result.kind, "permitted", result.kind === "unsupported" ? result.detail : undefined);
    if (result.kind !== "permitted") return;
    try {
      const exported = await result.witness.export();
      assert.equal(exported.kind, "exported");
      if (exported.kind === "exported") assert.equal(createSpacesVerifier({ root, authenticate: authenticateArchon })
        .verify({ query: query("captured"), proof: exported.proof }).permitted, true);
    } finally { result.witness.close(); }
  } finally { runtime.close(); }
});

test("a rejected required export releases its detached witness", async t => {
  const failure = new Error("synthetic retained materialization failure");
  const close = SpacesWitness.prototype.close;
  let closed = 0;
  t.mock.method(SpacesWitness.prototype, "export", async () => { throw failure; });
  t.mock.method(SpacesWitness.prototype, "close", function (this: SpacesWitness) { closed++; close.call(this); });
  const runtime = await createSpacesRuntime({ root, bundles: [], authenticate: authenticateArchon, preparationBudget: budget });
  try {
    await assert.rejects(runtime.decide({ query: { actor: root, statement: atom("synthetic-action"), space: service },
      observations: [], portable: "required" }), error => error === failure);
    assert.equal(closed, 1);
  } finally { runtime.close(); }
});
