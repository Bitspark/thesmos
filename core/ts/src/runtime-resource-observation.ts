// Temporary diagnostic-only boundary. This module is not a package entry point.
// Copy the paired host's fixed record; never infer allocator ownership or decode
// u64 counter words into JavaScript Numbers. The actual host validates guest ABI
// publication/association; its validity flags remain independent observations.

const operations = ["program_open", "base_open", "request_open", "admit", "execute", "materialize", "close", "diagnostics", "unknown"] as const;
const phases = ["guards", "encode", "post-encode-guards", "input-buffer", "export-call", "reply", "complete"] as const;
const exports = ["logos_alloc", "logos_prepared", "logos_dealloc"] as const;
const statuses = ["observed", "disabled", "unavailable", "read-failed", "invalid", "partial"] as const;
const reasons = ["missing-exports", "configure-rejected", "configure-threw", "address", "length", "bounds", "header",
  "reserved", "field", "publication", "association-rejected", "association-threw", "read-threw", "mode"] as const;
const associations = ["accepted", "disabled", "rejected", "failed", "not-requested"] as const;

function invalid(): never { throw new TypeError("Invalid fixed prepared resource observation"); }

function object(value: unknown, fields: readonly string[]): object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) return invalid();
  return value;
}

function data(value: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || !("value" in descriptor)) return invalid();
  return descriptor.value;
}

function oneOf<const T extends readonly string[]>(value: unknown, choices: T): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) return invalid();
  return value as T[number];
}

function number(value: unknown, maximum = Number.MAX_VALUE): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) return invalid();
  return value;
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = number(value, maximum);
  if (!Number.isSafeInteger(result)) return invalid();
  return result;
}

function positive(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = integer(value, maximum);
  return result > 0 ? result : invalid();
}

function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function digest(value: unknown): string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : invalid(); }

function array<T>(value: unknown, maximum: number, copy: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalid();
  const length = integer(data(value, "length"), maximum);
  // Reject holes, extra keys, symbols and accessors without invoking array
  // iterators, element getters or toJSON on any caller-provided object.
  if (Reflect.ownKeys(value).length !== length + 1) return invalid();
  const result: T[] = [];
  for (let index = 0; index < length; index++) result.push(copy(data(value, String(index))));
  return result;
}

function snapshot(value: unknown) {
  const source = object(value, ["status", "reason", "association", "memoryPages", "words", "aggregateValid", "associationValid"]);
  const status = oneOf(data(source, "status"), statuses);
  const reasonValue = data(source, "reason");
  const reason = reasonValue === null ? null : oneOf(reasonValue, reasons);
  const association = oneOf(data(source, "association"), associations);
  const pagesValue = data(source, "memoryPages");
  const memoryPages = pagesValue === null ? null : integer(pagesValue, 65536);
  const raw = data(source, "words");
  const carriesWords = status === "observed" || status === "disabled";
  const words = raw === null ? null : array(raw, 320, word => integer(word, 0xffff_ffff));
  if (carriesWords !== (words !== null) || (words !== null && words.length !== 320)) return invalid();
  const aggregateValid = boolean(data(source, "aggregateValid"));
  const associationValid = boolean(data(source, "associationValid"));
  if (status !== "observed" && (aggregateValid || associationValid)) return invalid();
  return { status, reason, association, memoryPages, words, aggregateValid, associationValid };
}

function identity(value: unknown) {
  const source = object(value, ["status", "sha256", "hashWallMs"]);
  const status = oneOf(data(source, "status"), ["observed", "unavailable", "failed"] as const);
  const sha = data(source, "sha256");
  if (status !== "observed" && sha !== null) return invalid();
  return { status, sha256: status === "observed" ? digest(sha) : null, hashWallMs: number(data(source, "hashWallMs")) };
}

function wireIdentity(value: unknown) {
  const source = object(value, ["status", "bytes", "sha256", "hashWallMs"]);
  const status = oneOf(data(source, "status"), ["not-observed", "observed", "failed"] as const);
  const sha = data(source, "sha256"), bytesValue = data(source, "bytes");
  if ((status !== "observed" && sha !== null) || (status === "not-observed" && bytesValue !== null)) return invalid();
  return { status, bytes: status === "not-observed" ? null : integer(bytesValue),
    sha256: status === "observed" ? digest(sha) : null, hashWallMs: number(data(source, "hashWallMs")) };
}

function hostMemory(value: unknown) {
  const source = object(value, ["limitPages", "pageBytes", "limitBytes"]);
  // This paired private /2 domain mirrors Logos host_abi.ts MAX_MEMORY_PAGES,
  // enforced by Searcher before installing its memory_limit_pages import. It is
  // not wasm32's theoretical address-space bound or a new public SPI option.
  const limitPages = positive(data(source, "limitPages"), 16384);
  const pageBytes = integer(data(source, "pageBytes"));
  const limitBytes = positive(data(source, "limitBytes"));
  if (pageBytes !== 65536 || limitBytes !== limitPages * pageBytes) return invalid();
  // This is the selected cooperative host cap, not a module-declared maximum,
  // current extent or evidence that an allocator growth attempt reached it.
  return { limitPages, pageBytes, limitBytes };
}

function preparedInput(value: unknown) {
  const source = object(value, ["status", "limitBytes", "reason"]);
  const status = oneOf(data(source, "status"), ["observed", "unavailable", "invalid", "read-failed"] as const);
  const bytes = data(source, "limitBytes"), reason = data(source, "reason");
  if (status === "observed") {
    if (reason !== null) return invalid();
    return { status, limitBytes: positive(bytes, 0xffff_ffff), reason: null };
  }
  if (bytes !== null) return invalid();
  const expected = status === "unavailable" ? ["missing-export", "instance-not-bound"] as const
    : status === "invalid" ? ["invalid-scalar"] as const : ["export-threw"] as const;
  return { status, limitBytes: null, reason: oneOf(reason, expected) };
}

function exportKey(value: unknown) {
  const source = object(value, ["export", "ordinal"]);
  return { export: oneOf(data(source, "export"), exports), ordinal: positive(data(source, "ordinal"), 0xffff_ffff) };
}

function exportObservation(value: unknown) {
  const source = object(value, ["export", "ordinal", "outcome", "args", "startedAtMs", "finishedAtMs", "before", "after"]);
  const startedAtMs = number(data(source, "startedAtMs")), finishedAtMs = number(data(source, "finishedAtMs"));
  if (finishedAtMs < startedAtMs) return invalid();
  return {
    export: oneOf(data(source, "export"), exports), ordinal: positive(data(source, "ordinal"), 0xffff_ffff),
    outcome: oneOf(data(source, "outcome"), ["returned", "threw"] as const),
    args: array(data(source, "args"), 4, scalar => integer(scalar, 0xffff_ffff)), startedAtMs, finishedAtMs,
    before: snapshot(data(source, "before")), after: snapshot(data(source, "after")),
  };
}

/** Accept exactly the paired private schema and return wholly independent data.
 * No returned object/array aliases the host record. No input getters, iterator,
 * toJSON, source graph or Error fields participate in the serialized envelope. */
export function copyPreparedResourceRecord(value: unknown) {
  const source = object(value, ["schema", "mode", "searcher", "hostCall", "operation", "startedGeneration", "generation", "hostMemory", "preparedInput", "guestWindow",
    "clock", "timeOriginMs", "startedAtMs", "finishedAtMs", "guestIdentity", "wire", "phase", "outcome", "encodingReturned",
    "inputAllocation", "inputAllocationReturned", "inputWritten", "exportEntry", "firstThrownExport", "exports", "droppedExports",
    "collectorValid", "collectorWallMs", "instanceSetupWallMs"]);
  const startedAtMs = number(data(source, "startedAtMs")), finishedAtMs = number(data(source, "finishedAtMs"));
  if (finishedAtMs < startedAtMs) return invalid();
  const window = data(source, "guestWindow"), thrown = data(source, "firstThrownExport"), setup = data(source, "instanceSetupWallMs");
  const phase = oneOf(data(source, "phase"), phases), outcome = oneOf(data(source, "outcome"), ["returned", "threw"] as const);
  if ((phase === "complete") !== (outcome === "returned")) return invalid();
  return {
    schema: oneOf(data(source, "schema"), ["logos/prepared-resource-observation/2"] as const),
    mode: oneOf(data(source, "mode"), ["minimal", "compiled-disabled"] as const),
    searcher: positive(data(source, "searcher")), hostCall: positive(data(source, "hostCall")),
    operation: oneOf(data(source, "operation"), operations),
    startedGeneration: positive(data(source, "startedGeneration")), generation: positive(data(source, "generation")),
    hostMemory: hostMemory(data(source, "hostMemory")), preparedInput: preparedInput(data(source, "preparedInput")),
    guestWindow: window === null ? null : positive(window, 0xffff_ffff),
    clock: oneOf(data(source, "clock"), ["performance.now"] as const), timeOriginMs: number(data(source, "timeOriginMs")),
    startedAtMs, finishedAtMs, guestIdentity: identity(data(source, "guestIdentity")), wire: wireIdentity(data(source, "wire")),
    phase, outcome, encodingReturned: boolean(data(source, "encodingReturned")), inputAllocation: boolean(data(source, "inputAllocation")),
    inputAllocationReturned: boolean(data(source, "inputAllocationReturned")), inputWritten: boolean(data(source, "inputWritten")),
    exportEntry: boolean(data(source, "exportEntry")), firstThrownExport: thrown === null ? null : exportKey(thrown),
    exports: array(data(source, "exports"), 16, exportObservation), droppedExports: integer(data(source, "droppedExports")),
    collectorValid: boolean(data(source, "collectorValid")), collectorWallMs: number(data(source, "collectorWallMs")),
    instanceSetupWallMs: setup === null ? null : number(setup),
  };
}

export type PreparedResourceRecord = ReturnType<typeof copyPreparedResourceRecord>;
