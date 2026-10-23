// Selected remote profiling retention only. The general private /3 copier still
// accepts sixteen exports. No guest call, allocator decision or product error is
// made here; all failures are separate evidence about this bounded sink.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { copyPreparedResourceRecord, type PreparedResourceRecord } from "./runtime-resource-observation.js";

export const RESOURCE_MEMBERS = Object.freeze({
  prefix: "runtime-resources.ndjson",
  failure: "runtime-resources-first-allocation-failure.json",
  coverage: "runtime-resources-coverage.json",
});
export const RESOURCE_LIMITS = Object.freeze({ rowBytes: 803967, prefixRows: 82, coverageBytes: 65536, combinedBytes: 67108864 });
const lifecycles = ["create", "request", "request-execute", "request-close", "request-diagnostics", "replace",
  "runtime-close", "runtime-diagnostics", "witness-export", "witness-close", "witness-diagnostics", "extra-witness-close"];
const outerKeys = ["format", "sequence", "activation", "lifecycle", "at", "elapsedMs", "timeOriginMs", "pid", "source", "run",
  "buildReceiptSha256", "captureId", "configurationSha256", "executionClass", "observation"];
type Fault = "selected-row-invalid" | "sequence-invalid" | "prefix-write-failed" | "reserve-write-failed" |
  "coverage-write-failed" | "finalize-failed" | "counter-overflow";
type Limitation = "rejected-row" | "unreadable-snapshot" | "unbound-snapshot" | "invalid-latch" | "disabled-observation";
type Stop = "row-limit" | "invalid-row" | "sequence-gap" | "write-failed" | null;
type Reference = { member: string; offset: number; bytes: number; sha256: string };
type PrefixReference = Omit<Reference, "member"> & { sequence: number };
export type ResourceBinding = {
  source: { logos: string; thesmos: string }; run: string; buildReceiptSha256: string;
  captureId: string; configurationSha256: string; executionClass: "minimal-diagnostic" | "focused-diagnostic";
  pid: number; timeOriginMs: number;
};
export type ResourceEnvelope = ResourceBinding & {
  format: "thesmos/prepared-resource-observation/1"; sequence: number; activation: number;
  lifecycle: string; at: string; elapsedMs: number; observation: PreparedResourceRecord;
};
type Snapshot = PreparedResourceRecord["exports"][number]["before"];
type Selection = {
  outerSequence: number; activation: number; lifecycle: string; searcher: number; generation: number; hostCall: number;
  guestWindow: number; guestSha256: string; export: { name: string; ordinal: number; edge: "before" | "after" };
  snapshot: Omit<Snapshot, "words"> & { wordsSha256: string };
  anchor: { wordOffset: 4608; wordCount: 128; words: number[]; sha256: string };
};
export type ResourceCoverage = {
  format: "thesmos/prepared-resource-retention/1"; status: "recording" | "complete" | "partial" | "failed";
  binding: ResourceBinding; limits: typeof RESOURCE_LIMITS;
  prefix: { member: string; rows: number; bytes: number; sha256: string; firstSequence: number | null;
    lastSequence: number | null; stop: Stop; partialTailBytes: number | null; records: PrefixReference[] };
  firstAllocationFailure: { status: "not-observed" | "retained" | "unavailable"; selection: Selection | null;
    reference: Reference | null; earliest: { status: "observed-order" | "limited"; limitations: Limitation[] };
    eligibleObservationsAfterSelection: number };
  observed: { callbacks: number; validRows: number; invalidRows: number; omittedRows: number;
    firstSequence: number | null; lastSequence: number | null; unavailableSnapshots: number; ineligibleLatches: number };
  faults: Fault[]; finalization: { status: "pending" | "exit-observed"; exitCode: number | null };
  authority: { selection: "earliest-observed-eligible-lifetime-latch"; classValidation: "not-performed";
    productOutcome: "not-assessed"; coverage: "contiguous-prefix-plus-at-most-one-noncontiguous-row" };
};

function need(condition: unknown): asserts condition { if (!condition) throw new TypeError("Invalid selected resource observation"); }
function own(value: unknown, keys: readonly string[]): Record<string, unknown> {
  need(value !== null && typeof value === "object" && !Array.isArray(value));
  const names = Reflect.ownKeys(value);
  need(names.length === keys.length && names.every(name => typeof name === "string" && keys.includes(name)));
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(descriptor && "value" in descriptor);
    copy[key] = descriptor.value;
  }
  return copy;
}
function natural(value: unknown, positive = false): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= (positive ? 1 : 0);
}
function time(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function hex(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && !/[^a-f0-9]/.test(value);
}
function binding(value: unknown): ResourceBinding {
  const raw = own(value, ["source", "run", "buildReceiptSha256", "captureId", "configurationSha256", "executionClass", "pid", "timeOriginMs"]);
  const source = own(raw.source, ["logos", "thesmos"]);
  need(hex(source.logos, 40) && hex(source.thesmos, 40) && hex(raw.buildReceiptSha256, 64) && hex(raw.configurationSha256, 64));
  need(typeof raw.run === "string" && raw.run.length >= 1 && raw.run.length <= 20 && /^[1-9][0-9]*$/.exec(raw.run)?.[0] === raw.run);
  need(typeof raw.captureId === "string" && raw.captureId.length === 36 &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(raw.captureId));
  need(raw.executionClass === "minimal-diagnostic" || raw.executionClass === "focused-diagnostic");
  need(natural(raw.pid, true) && time(raw.timeOriginMs));
  return { source: { logos: source.logos, thesmos: source.thesmos }, run: raw.run, buildReceiptSha256: raw.buildReceiptSha256,
    captureId: raw.captureId, configurationSha256: raw.configurationSha256, executionClass: raw.executionClass,
    pid: raw.pid, timeOriginMs: raw.timeOriginMs };
}
function sameBinding(left: ResourceBinding, right: ResourceBinding): boolean {
  return left.source.logos === right.source.logos && left.source.thesmos === right.source.thesmos &&
    left.run === right.run && left.buildReceiptSha256 === right.buildReceiptSha256 && left.captureId === right.captureId &&
    left.configurationSha256 === right.configurationSha256 && left.executionClass === right.executionClass &&
    left.pid === right.pid && left.timeOriginMs === right.timeOriginMs;
}
function rowBinding(raw: Record<string, unknown>): ResourceBinding {
  return binding({ source: raw.source, run: raw.run, buildReceiptSha256: raw.buildReceiptSha256, captureId: raw.captureId,
    configurationSha256: raw.configurationSha256, executionClass: raw.executionClass, pid: raw.pid, timeOriginMs: raw.timeOriginMs });
}
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function wordHash(words: readonly number[]): string {
  const encoded = Buffer.alloc(words.length * 4);
  words.forEach((word, index) => encoded.writeUInt32LE(word, index * 4));
  return sha(encoded);
}
function u64(words: readonly number[], index: number): bigint { return BigInt(words[index]!) | BigInt(words[index + 1]!) << 32n; }

// The finite metadata proof is executable, independent of the final byte bound.
// Only words are elided in this measurement projection; retained bytes are never
// replaced by this projection. The detached copier already excludes accessors.
function metadataBounds(row: ResourceEnvelope): void {
  let keys = 0, containers = 0, arrayScalars = 0;
  function walk(value: unknown, key?: string): unknown {
    if (key === "words") return null;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { need(bytes(JSON.stringify(value)) <= 66); return value; }
    if (typeof value === "number") { need(Number.isFinite(value) && bytes(JSON.stringify(value)) <= 32); return value; }
    containers++;
    if (Array.isArray(value)) return value.map(item => {
      if (typeof item === "number") arrayScalars++;
      return walk(item);
    });
    need(value !== null && typeof value === "object");
    const result: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value)) {
      keys++; need(bytes(JSON.stringify(name)) <= 32); result[name] = walk(item, name);
    }
    return result;
  }
  const projection = walk(row);
  need(keys <= 149 && arrayScalars <= 16 && containers <= 25 && bytes(JSON.stringify(projection)) <= 16384);
}

/** Strict selected route; the ordinary sixteen-export copier remains separate. */
export function copySelectedResourceEnvelope(value: unknown, expected: ResourceBinding): ResourceEnvelope {
  const raw = own(value, outerKeys), context = rowBinding(raw);
  need(sameBinding(context, expected));
  need(raw.format === "thesmos/prepared-resource-observation/1" && natural(raw.sequence, true) && natural(raw.activation, true));
  need(typeof raw.lifecycle === "string" && lifecycles.includes(raw.lifecycle));
  need(typeof raw.at === "string" && raw.at.length === 24 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.at));
  need(time(raw.elapsedMs));
  const observation = copyPreparedResourceRecord(raw.observation);
  need(observation.exports.length <= 4 && observation.droppedExports === 0);
  if (observation.guestIdentity.sha256 !== null) need(hex(observation.guestIdentity.sha256, 64));
  if (observation.wire.sha256 !== null) need(hex(observation.wire.sha256, 64));
  const ordinals = new Set<number>();
  for (const item of observation.exports) {
    need(!ordinals.has(item.ordinal)); ordinals.add(item.ordinal);
    need(item.startedAtMs >= observation.startedAtMs && item.finishedAtMs <= observation.finishedAtMs);
  }
  const result: ResourceEnvelope = { format: "thesmos/prepared-resource-observation/1", sequence: raw.sequence,
    activation: raw.activation, lifecycle: raw.lifecycle, at: raw.at, elapsedMs: raw.elapsedMs, ...context, observation };
  metadataBounds(result);
  need(bytes(JSON.stringify(result)) + 1 <= RESOURCE_LIMITS.rowBytes);
  return result;
}

// This is framing/association selection, not a second class decoder. Invalid
// arithmetic/class flags stay in the raw latch for the independent reader.
function eligible(row: ResourceEnvelope, item: PreparedResourceRecord["exports"][number], edge: "before" | "after"):
  { selection?: Selection; limitation?: Limitation; latch: boolean } {
  const record = row.observation, snapshot = item[edge], words = snapshot.words;
  if (snapshot.status === "disabled") return { limitation: "disabled-observation", latch: false };
  if (words === null || snapshot.status !== "observed") return { limitation: "unreadable-snapshot", latch: false };
  if (record.startedGeneration !== record.generation || record.guestIdentity.status !== "observed" ||
      !hex(record.guestIdentity.sha256, 64) || record.guestWindow === null || snapshot.association !== "accepted" ||
      !snapshot.associationValid || snapshot.reason !== null) return { limitation: "unbound-snapshot", latch: words[4608] !== 0 };
  const framing = words[0] === 0x4c4d4f32 && words[1] === 2 && words[2] === 35840 && words[7] === 35840 &&
    words[26] === 31 && words[3]! % 2 === 0 && words[4] === 1 && words[5] === 1 &&
    !(words[6]! & ~127) && !(words[6]! & (1 | 4 | 8 | 16 | 32 | 64)) &&
    words[321] === 1056 && words[322] === 33 && words[323] === 32 && words[324] === 384 &&
    words[325] === 4608 && words[326] === 4736 && words[327] === 4 &&
    snapshot.memoryPages === words[9] && words[9]! <= 65536 && words[27] === 1;
  // begin/end retain the actual ordinal and window separately. A returned after
  // snapshot has last-* association; a throwing after snapshot stays active.
  const associated = edge === "before" || item.outcome === "threw"
    ? words[14] === 1 && words[10] === record.guestWindow && words[11] === record.guestWindow && words[12] === item.ordinal
    : words[14] === 0 && words[15] === item.ordinal && words[16] === record.guestWindow && words[17] === record.guestWindow;
  if (!framing || !associated) return { limitation: "unbound-snapshot", latch: words[4608] !== 0 };
  if (words[4608] === 0) return words[168] === 0 && u64(words, 46) === 0n && words.slice(4608).every(word => word === 0)
    ? { latch: false } : { limitation: "invalid-latch", latch: true };
  const anchor = words.slice(4608, 4736), attempt = anchor.slice(24, 72), seq = u64(anchor, 8);
  const ownContext = anchor[20] === 1
    ? anchor[16]! > 0 && anchor[17]! > 0 && anchor[18]! > 0 &&
      anchor[16] === attempt[4] && anchor[17] === attempt[5] && anchor[18] === attempt[6] && anchor[19] === attempt[7]
    : attempt.slice(4, 8).every(word => word === 0);
  const ownFailure = anchor[0] === 1 && anchor[3] === 1 && anchor[4]! <= 1 && anchor[7] === 1 &&
    anchor[5] === words[8] && anchor[6]! <= words[9]! && anchor[6] === attempt[16] &&
    u64(anchor, 14) <= u64(words, 18) && !(anchor[2]! & ~127) && anchor[20]! <= 1 && anchor[126] === 0 && anchor[127] === 0 &&
    attempt[0] === 3 && attempt[1]! >= 1 && attempt[1]! <= 3 && seq > 0n && seq === u64(anchor, 10) &&
    seq === u64(anchor, 22) && seq === u64(attempt, 2) && seq <= u64(words, 20) && seq <= u64(words, 22) &&
    attempt[14] === 0 && attempt[17]! <= 1 && !(attempt[19]! & ~127) && attempt[36]! <= 3 &&
    attempt.slice(45).every(word => word === 0) && ownContext && anchor[16]! <= record.guestWindow &&
    anchor[17]! <= record.guestWindow && anchor[18]! <= item.ordinal &&
    attempt.every((word, index) => word === words[168 + index]);
  if (!ownFailure) return { limitation: "invalid-latch", latch: true };
  const ownAnchor = { wordOffset: 4608 as const, wordCount: 128 as const, words: anchor, sha256: wordHash(anchor) };
  need(bytes(JSON.stringify(ownAnchor)) <= 2048);
  return { latch: true, selection: {
    outerSequence: row.sequence, activation: row.activation, lifecycle: row.lifecycle, searcher: record.searcher,
    generation: record.generation, hostCall: record.hostCall, guestWindow: record.guestWindow, guestSha256: record.guestIdentity.sha256,
    export: { name: item.export, ordinal: item.ordinal, edge },
    snapshot: { status: snapshot.status, reason: snapshot.reason, association: snapshot.association, memoryPages: snapshot.memoryPages,
      aggregateValid: snapshot.aggregateValid, associationValid: snapshot.associationValid, wordsSha256: wordHash(words) }, anchor: ownAnchor,
  } };
}

/** Narrow storage seam permits controls to exercise real partial-write failures.
 * Implementations must not overwrite an existing prefix/reserve or follow links. */
export type ResourceStorage = {
  appendPrefix(data: Uint8Array, offset: number): void;
  writeReserve(data: Uint8Array): void;
  writeCoverage(data: Uint8Array): void;
  prefixSize(): number | null;
  settlePrefix(): void;
  closeCoverage(): void;
};

export function createResourceRetention(directory: string, context: ResourceBinding): SelectedResourceRetention {
  let prefix: number | undefined, coverage: number | undefined;
  const fresh = (name: string) => openSync(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  const regular = (fd: number) => { const stat = fstatSync(fd); need(stat.isFile() && stat.nlink === 1); return stat.size; };
  const write = (fd: number, data: Uint8Array, offset: number) => {
    let done = 0;
    while (done < data.byteLength) {
      const count = writeSync(fd, data, done, data.byteLength - done, offset + done);
      need(count > 0); done += count;
    }
  };
  return new SelectedResourceRetention(context, {
    appendPrefix(data, offset) {
      prefix ??= fresh(RESOURCE_MEMBERS.prefix);
      need(regular(prefix) === offset); write(prefix, data, offset); need(regular(prefix) === offset + data.byteLength);
    },
    writeReserve(data) {
      const fd = fresh(RESOURCE_MEMBERS.failure);
      try { write(fd, data, 0); need(regular(fd) === data.byteLength); fsyncSync(fd); }
      finally { closeSync(fd); }
    },
    writeCoverage(data) {
      coverage ??= fresh(RESOURCE_MEMBERS.coverage);
      need(regular(coverage) <= RESOURCE_LIMITS.coverageBytes);
      write(coverage, data, 0); ftruncateSync(coverage, data.byteLength); fsyncSync(coverage);
    },
    prefixSize() { try { return prefix === undefined ? null : regular(prefix); } catch { return null; } },
    settlePrefix() {
      const fd = prefix; prefix = undefined;
      if (fd !== undefined) { try { fsyncSync(fd); } finally { closeSync(fd); } }
    },
    closeCoverage() { const fd = coverage; coverage = undefined; if (fd !== undefined) closeSync(fd); },
  });
}

/** One selected process/capture. No product values or exceptions enter storage. */
export class SelectedResourceRetention {
  readonly #storage: ResourceStorage;
  readonly #coverage: ResourceCoverage;
  readonly #prefixHash = createHash("sha256");
  #ended = false;
  #coverageFailed = false;
  #reserveAttemptBytes = 0;
  constructor(context: ResourceBinding, storage: ResourceStorage) {
    this.#storage = storage;
    this.#coverage = {
      format: "thesmos/prepared-resource-retention/1", status: "recording", binding: binding(context), limits: RESOURCE_LIMITS,
      prefix: { member: RESOURCE_MEMBERS.prefix, rows: 0, bytes: 0, sha256: sha(""), firstSequence: null, lastSequence: null,
        stop: null, partialTailBytes: 0, records: [] },
      firstAllocationFailure: { status: "not-observed", selection: null, reference: null,
        earliest: { status: "observed-order", limitations: [] }, eligibleObservationsAfterSelection: 0 },
      observed: { callbacks: 0, validRows: 0, invalidRows: 0, omittedRows: 0, firstSequence: null, lastSequence: null,
        unavailableSnapshots: 0, ineligibleLatches: 0 }, faults: [], finalization: { status: "pending", exitCode: null },
      authority: { selection: "earliest-observed-eligible-lifetime-latch", classValidation: "not-performed",
        productOutcome: "not-assessed", coverage: "contiguous-prefix-plus-at-most-one-noncontiguous-row" },
    };
    try { storage.appendPrefix(new Uint8Array(), 0); }
    catch { this.#fault("prefix-write-failed"); this.#coverage.prefix.stop = "write-failed"; this.#tail(); }
    this.#checkpoint();
  }
  snapshot(): ResourceCoverage { return structuredClone(this.#coverage); }
  #fault(code: Fault): void { if (!this.#coverage.faults.includes(code)) this.#coverage.faults.push(code); }
  #increment(object: Record<string, number>, key: string): void {
    const current = object[key]!;
    if (!natural(current) || current === Number.MAX_SAFE_INTEGER) { this.#fault("counter-overflow"); throw new RangeError("Resource counter overflow"); }
    object[key] = current + 1;
  }
  #limit(code: Limitation): void {
    const first = this.#coverage.firstAllocationFailure;
    if (first.selection !== null) return;
    first.earliest.status = "limited";
    if (!first.earliest.limitations.includes(code)) first.earliest.limitations.push(code);
  }
  #tail(): void {
    const size = this.#storage.prefixSize();
    this.#coverage.prefix.partialTailBytes = size === null || size < this.#coverage.prefix.bytes ? null : size - this.#coverage.prefix.bytes;
  }
  #checkpoint(): boolean {
    const value = this.#coverage;
    value.status = value.faults.length > 0 ? "failed" : value.observed.omittedRows > 0 || value.observed.invalidRows > 0 ? "partial"
      : value.finalization.status === "exit-observed" ? "complete" : "recording";
    const encoded = Buffer.from(JSON.stringify(value) + "\n");
    try {
      need(encoded.length <= RESOURCE_LIMITS.coverageBytes);
      need(value.prefix.bytes + (value.prefix.partialTailBytes ?? RESOURCE_LIMITS.rowBytes) + this.#reserveAttemptBytes + encoded.length <= RESOURCE_LIMITS.combinedBytes);
      this.#storage.writeCoverage(encoded); return true;
    } catch { this.#coverageFailed = true; this.#fault("coverage-write-failed"); value.status = "failed"; return false; }
  }
  accept(value: unknown): boolean {
    if (this.#ended) return false;
    const coverage = this.#coverage, observed = coverage.observed, prefix = coverage.prefix, first = coverage.firstAllocationFailure;
    let valid = true;
    try {
      this.#increment(observed as unknown as Record<string, number>, "callbacks");
      // A rejected inner record still occupies its actual outer sequence. This
      // permits a later eligible reserve after the explicitly broken prefix.
      const envelope = own(value, outerKeys);
      need(sameBinding(rowBinding(envelope), coverage.binding) && natural(envelope.sequence, true));
      const previous = observed.lastSequence;
      observed.firstSequence ??= envelope.sequence;
      if (previous === null || envelope.sequence > previous) observed.lastSequence = envelope.sequence;
      if (previous === null ? envelope.sequence !== 1
        : previous === Number.MAX_SAFE_INTEGER || envelope.sequence !== previous + 1) {
        this.#fault("sequence-invalid"); prefix.stop ??= "sequence-gap"; this.#limit("rejected-row"); valid = false;
        // An out-of-order row cannot establish the earliest observed selection.
        throw new TypeError("Noncontiguous selected resource sequence");
      }
      const row = copySelectedResourceEnvelope(value, coverage.binding);
      this.#increment(observed as unknown as Record<string, number>, "validRows");
      const encoded = Buffer.from(JSON.stringify(row) + "\n"), digest = sha(encoded);
      let chosen: Selection | undefined;
      for (const item of [...row.observation.exports].sort((a, b) => a.ordinal - b.ordinal)) {
        for (const edge of ["before", "after"] as const) {
          const outcome = eligible(row, item, edge);
          if (outcome.limitation) {
            if (outcome.latch) this.#increment(observed as unknown as Record<string, number>, "ineligibleLatches");
            else this.#increment(observed as unknown as Record<string, number>, "unavailableSnapshots");
            if (chosen === undefined) this.#limit(outcome.limitation);
          }
          if (outcome.selection) {
            if (first.selection === null && chosen === undefined) chosen = outcome.selection;
            else this.#increment(first as unknown as Record<string, number>, "eligibleObservationsAfterSelection");
          }
        }
      }
      let reference: Reference | null = null;
      if (prefix.stop === null && prefix.rows < RESOURCE_LIMITS.prefixRows) {
        try {
          this.#storage.appendPrefix(encoded, prefix.bytes);
          reference = { member: RESOURCE_MEMBERS.prefix, offset: prefix.bytes, bytes: encoded.length, sha256: digest };
          prefix.records.push({ sequence: row.sequence, offset: prefix.bytes, bytes: encoded.length, sha256: digest });
          prefix.rows++; prefix.bytes += encoded.length; prefix.firstSequence ??= row.sequence; prefix.lastSequence = row.sequence;
          this.#prefixHash.update(encoded); prefix.sha256 = this.#prefixHash.copy().digest("hex");
        } catch { this.#fault("prefix-write-failed"); prefix.stop = "write-failed"; this.#tail(); valid = false; }
      } else if (prefix.stop === null) prefix.stop = "row-limit";
      if (reference === null) this.#increment(observed as unknown as Record<string, number>, "omittedRows");
      if (chosen !== undefined) {
        first.selection = chosen; first.status = "unavailable";
        if (reference === null) {
          this.#reserveAttemptBytes = encoded.length;
          try { this.#storage.writeReserve(encoded); reference = { member: RESOURCE_MEMBERS.failure, offset: 0, bytes: encoded.length, sha256: digest }; }
          catch { this.#fault("reserve-write-failed"); valid = false; }
        }
        if (reference !== null) { first.reference = reference; first.status = "retained"; }
      }
    } catch {
      this.#fault("selected-row-invalid"); prefix.stop ??= "invalid-row"; this.#limit("rejected-row"); valid = false;
      if (observed.invalidRows < Number.MAX_SAFE_INTEGER) observed.invalidRows++;
      else this.#fault("counter-overflow");
    }
    return this.#checkpoint() && valid && !this.#coverageFailed && coverage.faults.length === 0;
  }
  finalize(exitCode: number): boolean {
    if (this.#ended) return false;
    this.#ended = true;
    try { need(natural(exitCode)); this.#coverage.finalization = { status: "exit-observed", exitCode }; }
    catch { this.#fault("finalize-failed"); }
    try { this.#storage.settlePrefix(); } catch { this.#fault("finalize-failed"); }
    const written = this.#checkpoint();
    try { this.#storage.closeCoverage(); } catch {
      // The last written checkpoint cannot attest a later failing close. The
      // runtime caller also records this refusal in its independent diagnostic
      // channel/exit status; a reader must not trust this file alone.
      this.#fault("finalize-failed"); this.#coverage.status = "failed"; return false;
    }
    return written && !this.#coverageFailed && this.#coverage.faults.length === 0;
  }
}
