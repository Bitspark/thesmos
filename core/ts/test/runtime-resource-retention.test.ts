import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyPreparedResourceRecord } from "../src/runtime-resource-observation.js";
import { copySelectedResourceEnvelope, createResourceRetention, RESOURCE_LIMITS, RESOURCE_MEMBERS, SelectedResourceRetention,
  type ResourceBinding, type ResourceCoverage, type ResourceEnvelope, type ResourceStorage } from "../src/runtime-resource-retention.js";

const context: ResourceBinding = {
  source: { logos: "1".repeat(40), thesmos: "2".repeat(40) }, run: "12345678901234567890",
  buildReceiptSha256: "3".repeat(64), captureId: "00000000-0000-4000-8000-000000000001",
  configurationSha256: "4".repeat(64), executionClass: "focused-diagnostic", pid: 1234, timeOriginMs: 1000,
};
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function rawHash(words: number[]): string {
  const buffer = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) buffer.writeUInt32LE(words[i]!, i * 4);
  return sha(buffer);
}
function raw(ordinal: number, edge: "before" | "after", failed: boolean): number[] {
  const w = Array<number>(8960).fill(0);
  w[0] = 0x4c4d4f32; w[1] = 2; w[2] = 35840; w[4] = 1; w[5] = 1; w[7] = 35840;
  w[8] = 258; w[9] = 266; w[10] = 7; w[11] = 7; w[12] = ordinal; w[14] = edge === "before" ? 1 : 0;
  w[15] = ordinal; w[16] = 7; w[17] = 7; w[18] = 6; w[20] = 3; w[22] = 3; w[26] = 31; w[27] = 1;
  w.splice(321, 7, 1056, 33, 32, 384, 4608, 4736, 4);
  if (failed) {
    // Independent raw framing fixture, not an assertion of class arithmetic.
    // First failure happened at an earlier export; later snapshots retain it.
    const a = 4608;
    w[a] = 1; w[a + 3] = 1; w[a + 4] = 1; w[a + 5] = 258; w[a + 6] = 265; w[a + 7] = 1;
    w[a + 8] = 2; w[a + 10] = 2; w[a + 12] = 2; w[a + 14] = 3;
    w[a + 16] = 6; w[a + 17] = 6; w[a + 18] = 1; w[a + 19] = 32; w[a + 20] = 1; w[a + 22] = 2;
    const attempt = Array<number>(48).fill(0);
    attempt[0] = 3; attempt[1] = 1; attempt[2] = 2; attempt[4] = 6; attempt[5] = 6;
    attempt[6] = 1; attempt[7] = 32; attempt[8] = 1024; attempt[10] = 1; attempt[15] = 265; attempt[16] = 265;
    w.splice(a + 24, 48, ...attempt); w.splice(168, 48, ...attempt);
  }
  return w;
}
function row(sequence = 1, failure = false, exports = 1): ResourceEnvelope {
  const snapshot = (ordinal: number, edge: "before" | "after") => ({ status: "observed" as const, reason: null,
    association: "accepted" as const, memoryPages: 266, words: raw(ordinal, edge, failure), aggregateValid: true, associationValid: true });
  return {
    format: "thesmos/prepared-resource-observation/1", sequence, activation: 1, lifecycle: "request",
    at: "2026-10-24T00:00:00.000Z", elapsedMs: 5, ...structuredClone(context),
    observation: {
      schema: "logos/prepared-resource-observation/3", mode: "minimal", searcher: 2, hostCall: 7, operation: "admit",
      startedGeneration: 1, generation: 1, hostMemory: { limitPages: 266, pageBytes: 65536, limitBytes: 266 * 65536 },
      preparedInput: { status: "observed", limitBytes: 67108864, reason: null }, guestWindow: 7,
      clock: "performance.now", timeOriginMs: 1000, startedAtMs: 1, finishedAtMs: 5,
      guestIdentity: { status: "observed", sha256: "5".repeat(64), hashWallMs: 0 },
      wire: { status: "observed", bytes: 8, sha256: "6".repeat(64), hashWallMs: 0 },
      phase: "complete", outcome: "returned", encodingReturned: true, inputAllocation: true,
      inputAllocationReturned: true, inputWritten: true, exportEntry: true, firstThrownExport: null,
      exports: Array.from({ length: exports }, (_, i) => ({ export: "logos_prepared" as const, ordinal: i + 2, outcome: "returned" as const,
        args: [1, 2, 3, 4], startedAtMs: 2, finishedAtMs: 4, before: snapshot(i + 2, "before"), after: snapshot(i + 2, "after") })),
      droppedExports: 0, collectorValid: true, collectorWallMs: 0, instanceSetupWallMs: 0,
    },
  };
}

class MemoryStorage implements ResourceStorage {
  prefix = Buffer.alloc(0); reserve: Buffer | undefined; coverage = Buffer.alloc(0);
  prefixFault = false; reserveFault = false; coverageFault = false; settleFault = false; closeFault = false;
  prefixWrites = 0; reserveWrites = 0; settled = false; closed = false;
  appendPrefix(data: Uint8Array, offset: number): void {
    assert.equal(offset, this.prefix.length);
    if (data.length > 0) this.prefixWrites++;
    if (this.prefixFault && data.length > 0) {
      this.prefix = Buffer.concat([this.prefix, data.slice(0, 13)]); throw new Error("controlled partial prefix write");
    }
    this.prefix = Buffer.concat([this.prefix, data]);
  }
  writeReserve(data: Uint8Array): void {
    this.reserveWrites++; assert.equal(this.reserve, undefined);
    this.reserve = Buffer.from(this.reserveFault ? data.slice(0, 17) : data);
    if (this.reserveFault) throw new Error("controlled partial reserve write");
  }
  writeCoverage(data: Uint8Array): void {
    if (this.coverageFault) { this.coverage = Buffer.from(data.slice(0, 19)); throw new Error("controlled coverage write"); }
    this.coverage = Buffer.from(data);
  }
  prefixSize(): number { return this.prefix.length; }
  settlePrefix(): void { this.settled = true; if (this.settleFault) throw new Error("controlled prefix settlement"); }
  closeCoverage(): void { this.closed = true; if (this.closeFault) throw new Error("controlled coverage close"); }
  report(): ResourceCoverage { return JSON.parse(this.coverage.toString()) as ResourceCoverage; }
}
function fixture() { const storage = new MemoryStorage(); return { storage, sink: new SelectedResourceRetention(context, storage) }; }

test("selected resource retention keeps the ordinary sixteen export protocol but refuses the fifth selected export", () => {
  assert.equal(copyPreparedResourceRecord(row(1, false, 16).observation).exports.length, 16);
  assert.equal(copySelectedResourceEnvelope(row(1, false, 4), context).observation.exports.length, 4);
  assert.throws(() => copySelectedResourceEnvelope(row(1, false, 5), context), TypeError);
  const { sink, storage } = fixture();
  assert.equal(sink.accept(row(1, false, 5)), false);
  assert.equal(storage.prefix.length, 0);
  assert.equal(sink.snapshot().prefix.stop, "invalid-row");
  assert.equal(sink.snapshot().observed.invalidRows, 1);
});

test("selected resource metadata enforces closed encoded scalars exact identities safe counters and literal lifecycles", () => {
  const mutations: ((r: ResourceEnvelope) => void)[] = [
    r => { r.run += "1"; }, r => { r.source.logos += "\n"; }, r => { r.configurationSha256 += "\n"; },
    r => { r.captureId += "\n"; }, r => { r.buildReceiptSha256 = "a".repeat(64); }, r => { r.pid++; },
    r => { r.lifecycle = "another-lifecycle"; }, r => { r.sequence = Number.MAX_SAFE_INTEGER + 1; },
    r => { r.activation = 0; }, r => { r.elapsedMs = Infinity; },
    r => { r.observation.guestIdentity.sha256 += "\n"; }, r => { r.observation.wire.sha256 += "\n"; },
    r => { r.observation.searcher = Number.MAX_SAFE_INTEGER + 1; }, r => { r.observation.droppedExports = 1; },
    r => { r.observation.exports[0]!.finishedAtMs = 6; },
    r => { Object.defineProperty(r.observation, "a".repeat(33), { value: "extra", enumerable: true }); },
  ];
  for (const mutate of mutations) { const value = row(); mutate(value); assert.throws(() => copySelectedResourceEnvelope(value, context), TypeError); }
  let called = false;
  const getter = row(); Object.defineProperty(getter, "source", { get() { called = true; return context.source; } });
  assert.throws(() => copySelectedResourceEnvelope(getter, context), TypeError); assert.equal(called, false);
  const wide = row(1, false, 4);
  for (const item of wide.observation.exports) for (const edge of ["before", "after"] as const) item[edge].words!.fill(0xffffffff);
  const copied = copySelectedResourceEnvelope(wide, context), encoded = Buffer.from(JSON.stringify(copied) + "\n");
  assert.ok(encoded.length > 788488 && encoded.length <= 803967, "eight full u32 arrays plus bounded metadata, without dropping words");
  assert.equal(copied.observation.exports[3]!.after.words!.length, 8960);
  assert.deepEqual(RESOURCE_LIMITS, { rowBytes: 803967, prefixRows: 82, coverageBytes: 65536, combinedBytes: 67108864 });
  assert.equal(82 * 803967 + 803967 + 65536, 66794797);
});

test("selected first allocation latch references exact prefix bytes and its own detached little endian anchors", () => {
  const { sink, storage } = fixture(), value = row(1, true);
  assert.equal(sink.accept(value), true);
  const first = sink.snapshot().firstAllocationFailure, reference = first.reference!, selection = first.selection!;
  assert.equal(first.status, "retained"); assert.equal(reference.member, RESOURCE_MEMBERS.prefix);
  assert.equal(reference.offset, 0); assert.equal(reference.bytes, storage.prefix.length); assert.equal(reference.sha256, sha(storage.prefix));
  assert.equal(storage.prefix.at(-1), 10); assert.equal(storage.reserve, undefined);
  assert.equal(selection.export.ordinal, 2); assert.equal(selection.export.edge, "before");
  assert.equal(selection.anchor.words[18], 1, "own earlier failure ordinal is not replaced by the observing export");
  assert.equal(selection.anchor.sha256, rawHash(value.observation.exports[0]!.before.words!.slice(4608, 4736)));
  assert.equal(selection.snapshot.wordsSha256, rawHash(value.observation.exports[0]!.before.words!));
  assert.ok(Buffer.byteLength(JSON.stringify(selection.anchor)) <= 2048);
  value.observation.exports[0]!.before.words![4608] = 0;
  assert.equal(sink.snapshot().firstAllocationFailure.selection!.anchor.words[0], 1);
  assert.equal(sink.finalize(1), true);
  assert.equal(storage.report().status, "complete");
  assert.deepEqual(storage.report().finalization, { status: "exit-observed", exitCode: 1 });
  assert.equal(storage.report().authority.productOutcome, "not-assessed");
});

test("selected failure ordering uses export ordinal then before after without reordering retained raw rows", () => {
  const { sink, storage } = fixture(), value = row(1, true, 3);
  value.observation.exports.reverse();
  assert.equal(sink.accept(value), true);
  assert.equal(sink.snapshot().firstAllocationFailure.selection!.export.ordinal, 2);
  assert.deepEqual(JSON.parse(storage.prefix.toString()).observation.exports.map((v: { ordinal: number }) => v.ordinal), [4, 3, 2]);
  assert.equal(sink.snapshot().firstAllocationFailure.eligibleObservationsAfterSelection, 5);
});

test("selected raw first latch survives independent class faults and aggregate invalidity without claiming table validity", () => {
  const { sink } = fixture(), value = row(1, true);
  for (const item of value.observation.exports) for (const edge of ["before", "after"] as const) {
    const s = item[edge], w = s.words!;
    w[320] = 4; w[4609] = 4; w[4610] = 2; w[6] = 2; w[386] = 0xffffffff;
    w[8959] = 0xffffffff; s.aggregateValid = false;
  }
  assert.equal(sink.accept(value), true);
  const first = sink.snapshot().firstAllocationFailure;
  assert.equal(first.status, "retained"); assert.equal(first.selection!.anchor.words[1], 4);
  assert.equal(first.selection!.snapshot.aggregateValid, false);
  assert.equal(sink.snapshot().authority.classValidation, "not-performed");
});

test("selected failure eligibility requires own completed latch sequence and actual unchanged instance association", () => {
  const mutations: ((r: ResourceEnvelope) => void)[] = [
    r => { r.observation.startedGeneration++; },
    r => { r.observation.guestIdentity = { status: "unavailable", sha256: null, hashWallMs: 0 }; },
    r => { r.observation.guestWindow = null; },
    ...[4618, 4630, 4634, 168, 169, 4608, 4612, 4613, 4622, 4734, 0, 325].map(at => (r: ResourceEnvelope) => {
      for (const item of r.observation.exports) for (const edge of ["before", "after"] as const) item[edge].words![at]! += 10;
    }),
    r => { for (const item of r.observation.exports) { item.before.words![12]!++; item.after.words![15]!++; } },
    r => { for (const item of r.observation.exports) for (const edge of ["before", "after"] as const) item[edge].words![4608] = 0; },
    r => { for (const item of r.observation.exports) for (const edge of ["before", "after"] as const) item[edge].associationValid = false; },
  ];
  for (const mutate of mutations) {
    const { sink, storage } = fixture(), value = row(1, true); mutate(value);
    assert.equal(sink.accept(value), true, "a framing refusal still preserves the raw prefix");
    assert.equal(sink.snapshot().firstAllocationFailure.status, "not-observed", "own completed latch sequence is required");
    assert.equal(sink.snapshot().firstAllocationFailure.earliest.status, "limited");
    assert.ok(storage.prefix.length > 0);
  }
});

test("selected disabled unavailable and thrown without allocation latch remain distinct incomplete observation domains", () => {
  const { sink } = fixture(), value = row();
  value.observation.mode = "compiled-disabled";
  for (const item of value.observation.exports) for (const edge of ["before", "after"] as const) {
    const snapshot = item[edge]; snapshot.status = "disabled"; snapshot.association = "disabled";
    snapshot.aggregateValid = false; snapshot.associationValid = false; snapshot.words![4] = 0;
  }
  assert.equal(sink.accept(value), true);
  const thrown = row(2); thrown.observation.phase = "export-call"; thrown.observation.outcome = "threw";
  thrown.observation.exports[0]!.outcome = "threw";
  thrown.observation.exports[0]!.after = { status: "read-failed", reason: "read-threw", association: "failed",
    memoryPages: null, words: null, aggregateValid: false, associationValid: false };
  assert.equal(sink.accept(thrown), true);
  const first = sink.snapshot().firstAllocationFailure;
  assert.equal(first.status, "not-observed");
  assert.deepEqual(first.earliest.limitations, ["disabled-observation", "unreadable-snapshot"]);
});

test("selected eighty two row prefix is complete at exit until an actual omitted row makes coverage partial", () => {
  const { sink, storage } = fixture();
  for (let i = 1; i <= 82; i++) assert.equal(sink.accept(row(i)), true);
  assert.equal(sink.snapshot().prefix.rows, 82); assert.equal(sink.snapshot().prefix.stop, null);
  assert.equal(sink.finalize(0), true); assert.equal(storage.report().status, "complete");
  const next = fixture();
  for (let i = 1; i <= 83; i++) assert.equal(next.sink.accept(row(i)), true);
  assert.equal(next.sink.finalize(0), true);
  assert.equal(next.storage.report().status, "partial"); assert.equal(next.storage.report().observed.omittedRows, 1);
  assert.equal(next.storage.report().prefix.stop, "row-limit"); assert.equal(next.storage.prefixWrites, 82);
});

test("selected late first failure is one separate immutable original row across later instances", () => {
  const { sink, storage } = fixture();
  for (let i = 1; i <= 83; i++) assert.equal(sink.accept(row(i)), true);
  const late = row(84, true); assert.equal(sink.accept(late), true);
  const saved = Buffer.from(storage.reserve!), first = sink.snapshot().firstAllocationFailure;
  assert.deepEqual(first.reference, { member: RESOURCE_MEMBERS.failure, offset: 0, bytes: saved.length, sha256: sha(saved) });
  assert.equal(JSON.parse(saved.toString()).sequence, 84);
  assert.equal(first.selection!.outerSequence, 84); assert.equal(first.earliest.status, "observed-order");
  const other = row(85, true); other.observation.searcher = 8; assert.equal(sink.accept(other), true);
  assert.equal(storage.reserveWrites, 1); assert.deepEqual(storage.reserve, saved);
  assert.deepEqual(sink.snapshot().firstAllocationFailure.selection, first.selection);
  assert.equal(sink.snapshot().prefix.lastSequence, 82);
  assert.ok(storage.prefix.length + storage.reserve!.length + storage.coverage.length < 67108864);
});

test("selected invalid row and sequence gaps never resume a prefix or silently prove earliest failure", () => {
  const { sink, storage } = fixture(); assert.equal(sink.accept(row(1)), true);
  assert.equal(sink.accept(row(2, false, 5)), false);
  assert.equal(sink.accept(row(3, true)), false, "valid reserve does not repair the earlier refused callback");
  assert.equal(sink.snapshot().prefix.rows, 1); assert.equal(storage.prefixWrites, 1);
  assert.equal(sink.snapshot().firstAllocationFailure.reference!.member, RESOURCE_MEMBERS.failure);
  assert.equal(sink.snapshot().firstAllocationFailure.earliest.status, "limited");
  assert.deepEqual(sink.snapshot().firstAllocationFailure.earliest.limitations, ["rejected-row"]);
  const gap = fixture(); gap.sink.accept(row(1)); assert.equal(gap.sink.accept(row(3, true)), false);
  assert.equal(gap.sink.accept(row(4, true)), false);
  assert.equal(gap.sink.snapshot().firstAllocationFailure.selection!.outerSequence, 4);
  assert.equal(gap.sink.snapshot().prefix.stop, "sequence-gap");
  for (const firstSequence of [2, Number.MAX_SAFE_INTEGER]) {
    const missingInitial = fixture();
    assert.equal(missingInitial.sink.accept(row(firstSequence, true)), false);
    assert.equal(missingInitial.sink.snapshot().prefix.rows, 0);
    assert.equal(missingInitial.sink.snapshot().prefix.stop, "sequence-gap");
    assert.equal(missingInitial.sink.snapshot().observed.firstSequence, firstSequence);
    assert.equal(missingInitial.sink.snapshot().observed.lastSequence, firstSequence);
    assert.equal(missingInitial.sink.snapshot().firstAllocationFailure.selection, null);
    assert.equal(missingInitial.sink.snapshot().firstAllocationFailure.earliest.status, "limited");
    if (firstSequence === 2) {
      assert.equal(missingInitial.sink.accept(row(3, true)), false);
      assert.equal(missingInitial.sink.snapshot().firstAllocationFailure.selection!.outerSequence, 3);
      assert.equal(missingInitial.sink.snapshot().firstAllocationFailure.reference!.member, RESOURCE_MEMBERS.failure);
      assert.equal(missingInitial.storage.prefix.length, 0);
    }
    assert.equal(missingInitial.sink.finalize(0), false);
    assert.equal(missingInitial.storage.report().status, "failed");
  }
});

test("selected partial prefix writes preserve complete bytes and retain failure separately without appending after damage", () => {
  const { sink, storage } = fixture(); sink.accept(row(1)); const before = Buffer.from(storage.prefix);
  storage.prefixFault = true; assert.equal(sink.accept(row(2, true)), false);
  assert.equal(sink.snapshot().prefix.bytes, before.length); assert.equal(sink.snapshot().prefix.sha256, sha(before));
  assert.equal(sink.snapshot().prefix.partialTailBytes, 13); assert.equal(storage.prefix.length, before.length + 13);
  assert.equal(sink.snapshot().firstAllocationFailure.reference!.member, RESOURCE_MEMBERS.failure);
  storage.prefixFault = false; assert.equal(sink.accept(row(3, true)), false);
  assert.equal(storage.prefixWrites, 2); assert.equal(storage.reserveWrites, 1);
  assert.equal(sink.finalize(1), false); assert.equal(storage.report().status, "failed");
});

test("selected reserve failure remains unavailable and never selects a later replacement", () => {
  const { sink, storage } = fixture();
  for (let i = 1; i <= 82; i++) sink.accept(row(i));
  storage.reserveFault = true; assert.equal(sink.accept(row(83, true)), false);
  assert.equal(sink.snapshot().firstAllocationFailure.status, "unavailable");
  assert.equal(sink.snapshot().firstAllocationFailure.reference, null);
  storage.reserveFault = false; assert.equal(sink.accept(row(84, true)), false);
  assert.equal(storage.reserveWrites, 1); assert.equal(storage.reserve!.length, 17);
  assert.equal(sink.snapshot().firstAllocationFailure.selection!.outerSequence, 83);
  assert.equal(sink.finalize(0), false); assert.ok(storage.report().faults.includes("reserve-write-failed"));
});

test("selected coverage and finalization failures stay explicit without losing the valid raw prefix", () => {
  for (const failure of ["coverageFault", "settleFault", "closeFault"] as const) {
    const { sink, storage } = fixture(); sink.accept(row(1)); const digest = sha(storage.prefix);
    storage[failure] = true;
    assert.equal(sink.finalize(1), false); assert.equal(sink.snapshot().status, "failed");
    assert.equal(sha(storage.prefix), digest); assert.equal(storage.settled, true); assert.equal(storage.closed, true);
    if (failure === "closeFault") assert.equal(storage.report().status, "complete",
      "the earlier persisted checkpoint cannot attest a later close: the runtime's independent failure channel must be joined");
    assert.equal(sink.accept(row(2)), false); assert.equal(storage.prefixWrites, 1);
  }
  const unfinished = fixture(); unfinished.sink.accept(row(1));
  assert.deepEqual(unfinished.storage.report().finalization, { status: "pending", exitCode: null });
  assert.equal(unfinished.storage.report().status, "recording");
});

test("selected filesystem retention writes only literal members and refuses an existing prefix without overwrite", () => {
  const directory = mkdtempSync(join(tmpdir(), "resource-retention-control-"));
  try {
    const sink = createResourceRetention(directory, context); assert.equal(sink.accept(row(1, true)), true);
    assert.equal(sink.finalize(1), true);
    assert.deepEqual(readdirSync(directory).sort(), [RESOURCE_MEMBERS.coverage, RESOURCE_MEMBERS.prefix].sort());
    const rawBytes = readFileSync(join(directory, RESOURCE_MEMBERS.prefix));
    const coverage = JSON.parse(readFileSync(join(directory, RESOURCE_MEMBERS.coverage), "utf8")) as ResourceCoverage;
    assert.equal(coverage.prefix.sha256, sha(rawBytes)); assert.equal(coverage.status, "complete");
    const refused = createResourceRetention(directory, context); assert.equal(refused.accept(row(1, true)), false);
    assert.equal(refused.finalize(0), false);
    assert.deepEqual(readFileSync(join(directory, RESOURCE_MEMBERS.prefix)), rawBytes);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
