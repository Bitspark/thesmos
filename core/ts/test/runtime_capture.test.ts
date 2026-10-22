import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { getPublicKey } from "@bitspark/archon";
import { Atom, Clause, ClauseId, Goal, MapProgram, PROGRAM_SERDE_VERSION, ProgramSerdeDecodeError, Term, Tuple, clauseValue, programBytes } from "@bitspark/logos-contract";
import { encode } from "@bitspark/ontos-codec";
import { encodeInt } from "@bitspark/ontos-data";
import { authenticateArchon, signSpaceFacts } from "../src/archon.js";
import { decodeSpaceFacts } from "../src/bundles.js";
import { loadLaw } from "../src/data.js";
import { atom, attributedClause, fact, path, suppliedClause } from "../src/encoding.js";
import { prepareSpacesOverlay, prepareSpacesProgram, PreparationRefused } from "../src/runtime.js";
import type { SpaceFactsBundle } from "../src/types.js";

const seed = new Uint8Array(32).fill(83), supplier = new Atom(getPublicKey(seed));
const placement = path("capture-controls");
const budget = { maxBundles: 10, maxClauses: 100, maxPayloadBytes: 1024 * 1024 };
const signed = (clauses: readonly Clause[], time = 0n): SpaceFactsBundle =>
  signSpaceFacts({ supplier, space: placement, assertedAt: encodeInt(time), clauses }, seed);
const assertion = (value: string): Clause => attributedClause(supplier, placement, fact("captured", atom(value)));
const sourceKey = (bundle: SpaceFactsBundle): string => createHash("sha256")
  .update(encode(new Tuple([new Atom(bundle.payload), bundle.authentication]))).digest("hex");

// A small independent whole-program oracle pins the public contract bytes and
// original guarded source IDs; it performs no inference or authority decision.
function expectedProgram(bundles: readonly SpaceFactsBundle[], includeLaw: boolean): MapProgram {
  const expected = includeLaw ? loadLaw() : new MapProgram();
  for (const bundle of bundles) {
    const output = decodeSpaceFacts(bundle.payload), key = sourceKey(bundle);
    for (const [index, clause] of output.clauses.entries()) {
      expected.insert(ClauseId.of(`supplied/${key}/${index}`), suppliedClause(clause, output.supplier, output.space));
    }
  }
  return expected;
}

test("incremental acquisition preserves canonical law, guarded clauses and whole source identities", () => {
  const variable = Term.var("Operation");
  const conditional = attributedClause(supplier, placement, new Clause(Goal.of("operation", [variable]), [
    Goal.of("authorized", [Term.fromValue(supplier), variable, Term.fromValue(placement)]),
    Goal.of("counts", [Term.fromValue(supplier), Term.fromValue(placement), variable]),
  ]));
  const first = signed([assertion("one"), conditional]), second = signed([assertion("two")], 1n);
  const bundles = [first, first, second];
  for (const includeLaw of [false, true]) {
    const expected = expectedProgram(bundles, includeLaw), calls: string[] = [];
    const request = { bundles, budget, authenticate: (input: Parameters<typeof authenticateArchon>[0]) => {
      calls.push(sourceKey(input));
      return authenticateArchon(input);
    } };
    const prepared = includeLaw ? prepareSpacesProgram(request) : prepareSpacesOverlay(request);
    const canonical = programBytes(expected);
    assert.deepEqual(calls, bundles.map(sourceKey));
    assert.deepEqual(prepared.canonicalProgramBytes(), canonical);
    assert.deepEqual(programBytes(prepared.nativeProgram()), canonical);
    assert.equal(prepared.identity, createHash("sha256").update(canonical).digest("hex"));
    assert.equal(prepared.clauseCount, 3);
    assert.equal(prepared.programEntryCount, expected.entries().length);
    assert.equal(prepared.programEntryCount, 3 + (includeLaw ? loadLaw().entries().length : 0));
    assert.equal(prepared.payloadBytes, bundles.reduce((sum, bundle) => sum + bundle.payload.byteLength, 0));
    assert.deepEqual(prepared.selectedBundles(), [first, second]);
    assert.deepEqual(prepared.sourceCosts().map(source => source.clauseId), [
      `supplied/${sourceKey(first)}/0`, `supplied/${sourceKey(first)}/1`, `supplied/${sourceKey(second)}/0`,
    ]);
    for (const [id, clause] of expected.entries()) {
      assert.deepEqual(encode(clauseValue(prepared.clause(id)!)), encode(clauseValue(clause)));
    }
    const guarded = prepared.clause(`supplied/${sourceKey(first)}/1`)!;
    assert.equal(guarded.body.length, 4);
    assert(guarded.body.every(premise => premise.isPos()));
    assert.deepEqual(guarded.body.map(premise => premise.lit.pred.bytes()),
      ["authorized", "counts", "authorized", "authorized"].map(name => Goal.of(name, []).pred.bytes()));
  }
});

test("duplicate sources authenticate and consume every acquisition budget before deduplication", () => {
  const first = signed([assertion("one")]), second = signed([assertion("two")], 1n);
  const bundles = [first, first, second];
  for (const [limits, expectedCalls] of [
    [{ ...budget, maxBundles: 2 }, 0],
    [{ ...budget, maxPayloadBytes: first.payload.byteLength * 2 }, 2],
    [{ ...budget, maxClauses: 2 }, 3],
  ] as const) {
    let calls = 0;
    assert.throws(() => prepareSpacesOverlay({ bundles, budget: limits, authenticate: input => {
      calls++;
      return authenticateArchon(input);
    } }), (error: unknown) => error instanceof PreparationRefused && error.code === "budget");
    assert.equal(calls, expectedCalls);
  }
  let calls = 0;
  const prepared = prepareSpacesOverlay({ bundles, budget, authenticate: input => {
    calls++;
    return authenticateArchon(input);
  } });
  assert.equal(calls, 3);
  assert.equal(prepared.clauseCount, 2);
  assert.equal(prepared.selectedBundles().length, 2);
});

test("incremental acquisition preserves authentication, count and assertion failure precedence", () => {
  const valid = signed([assertion("one")]);
  const malformed = signed([new Clause(Goal.of("not-attributed", []), [])]);
  let calls = 0;
  assert.throws(() => prepareSpacesOverlay({ bundles: [malformed, valid], budget, authenticate: () => {
    calls++;
    return false;
  } }), (error: unknown) => error instanceof PreparationRefused && error.code === "authentication");
  assert.equal(calls, 1);
  calls = 0;
  assert.throws(() => prepareSpacesOverlay({ bundles: [malformed, valid], budget: { ...budget, maxClauses: 0 }, authenticate: input => {
    calls++;
    return authenticateArchon(input);
  } }), (error: unknown) => error instanceof PreparationRefused && error.code === "budget");
  assert.equal(calls, 1);
  calls = 0;
  assert.throws(() => prepareSpacesOverlay({ bundles: [malformed, valid], budget, authenticate: input => {
    calls++;
    return authenticateArchon(input);
  } }), /Expected an attributed counts\/3 clause/);
  assert.equal(calls, 1);
  calls = 0;
  const original = new Error("later authentication failure");
  assert.throws(() => prepareSpacesOverlay({ bundles: [valid, valid, { payload: new Uint8Array([255]), authentication: atom("invalid") }], budget,
    authenticate: input => { if (++calls === 2) throw original; return authenticateArchon(input); },
  }), (error: unknown) => error === original);
  assert.equal(calls, 2);
});

test("later authentication cannot rewrite an earlier captured guarded source", () => {
  const first = signed([assertion("one")]), second = signed([assertion("two")], 1n);
  const bundles = [first, second], expected = expectedProgram(bundles, true);
  const canonical = programBytes(expected), firstPayload = Uint8Array.from(first.payload), firstKey = sourceKey(first);
  let calls = 0;
  const prepared = prepareSpacesProgram({ bundles, budget, authenticate: input => {
    const accepted = authenticateArchon(input);
    if (++calls === 2) {
      first.payload.fill(0);
      if (first.authentication instanceof Atom) first.authentication.bytes().fill(0);
    }
    input.payload.fill(0);
    if (input.supplier instanceof Atom) input.supplier.bytes().fill(0);
    return accepted;
  } });
  assert.equal(calls, 2);
  assert.deepEqual(prepared.canonicalProgramBytes(), canonical);
  assert.deepEqual(programBytes(prepared.nativeProgram()), canonical);
  assert.deepEqual(prepared.selectedBundles()[0]!.payload, firstPayload);
  assert.deepEqual(encode(clauseValue(prepared.clause(`supplied/${firstKey}/0`)!)),
    encode(clauseValue(expected.clause(ClauseId.of(`supplied/${firstKey}/0`))!)));
});

test("capture keeps final version timing and the authoritative native program decoder", () => {
  const bundles = [signed([assertion("one")]), signed([assertion("two")], 1n)];
  const expected = expectedProgram(bundles, false), originalVersion = Uint8Array.from(PROGRAM_SERDE_VERSION);
  const iterate = bundles[Symbol.iterator].bind(bundles);
  Object.defineProperty(bundles, Symbol.iterator, { value: function* () {
    yield* iterate();
    // This mutation occurs after every assertion and authenticator, at the
    // caller's final iterator pull, before the old constructor serialized it.
    PROGRAM_SERDE_VERSION[0] = PROGRAM_SERDE_VERSION[0]! ^ 32;
  } });
  let prepared: ReturnType<typeof prepareSpacesOverlay> | undefined;
  let canonical: Uint8Array | undefined;
  try {
    prepared = prepareSpacesOverlay({ bundles, budget, authenticate: authenticateArchon });
    canonical = programBytes(expected);
    assert.deepEqual(prepared.canonicalProgramBytes(), canonical);
  } finally { PROGRAM_SERDE_VERSION.set(originalVersion); }
  assert(prepared);
  assert(canonical);
  const captured = prepared;
  assert.throws(() => captured.nativeProgram(),
    (error: unknown) => error instanceof ProgramSerdeDecodeError && error.detail.kind === "bad_version");
  assert.deepEqual(captured.canonicalProgramBytes(), canonical);
  for (const [id, clause] of expected.entries()) {
    assert.deepEqual(encode(clauseValue(captured.clause(id)!)), encode(clauseValue(clause)));
  }
});
