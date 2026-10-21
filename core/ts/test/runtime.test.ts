import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getPublicKey } from "@bitspark/archon";
import { Atom, Clause, Goal, Term, VarId } from "@bitspark/logos-contract";
import { encodeInt } from "@bitspark/ontos-data";
import { atom, authorization, attributedClause, createSpacesVerifier, decodeProof, fact, path } from "../src/index.js";
import { authenticateArchon, signSpaceFacts } from "../src/archon.js";
import { createSpacesRuntime, instantiateSpacesObservations, prepareSpacesOverlay, prepareSpacesProgram, PreparationRefused } from "../src/runtime.js";

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
    const accepted = authenticateArchon(request); request.payload.fill(0); return accepted;
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
  } finally { runtime.close(); }
});
