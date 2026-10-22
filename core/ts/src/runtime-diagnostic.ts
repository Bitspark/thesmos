// Temporary source-bound instrumentation on runtime-base-phase-diagnostic only.
// This branch is not a release candidate and this module is not a public API.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";
import type { PreparedViewFactory } from "@bitspark/logos-kernel";

let sequence = 0;
let activation = 0;
let activePreparedScope: number | undefined;
const noSink = () => {};
type DiagnosticEdge = "start" | "complete" | "failed" | "observed" | "unavailable" | "read-failed" | "invalid";
type FailureSnapshot = {
  kind: "object" | "primitive" | "uninspectable" | "cycle" | "depth-limit";
  name?: string;
  message?: string;
  stack?: string;
  observed?: string;
  stackExhausted?: boolean;
  cause?: FailureSnapshot;
};

// Only bounded primitive fields leave this call. Never retain an Error, context,
// query, source graph or caller-owned cause, and never invoke a property getter.
function failureSnapshot(error: unknown, depth = 0, seen = new Set<object>()): FailureSnapshot {
  if (depth === 4) return { kind: "depth-limit" };
  if ((typeof error !== "object" || error === null) && typeof error !== "function")
    return { kind: "primitive", ...(typeof error === "string" ? { message: error.slice(0, 4096) } : {}) };
  if (seen.has(error)) return { kind: "cycle" };
  seen.add(error);
  try {
    const data = (key: string): unknown => {
      let current: object | null = error;
      for (let level = 0; current !== null && level < 6; level++) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
        current = Object.getPrototypeOf(current) as object | null;
      }
      return undefined;
    };
    const result: FailureSnapshot = { kind: "object" };
    for (const [key, limit] of [["name", 128], ["message", 4096], ["stack", 16384], ["observed", 1024]] as const) {
      const value = data(key);
      if (typeof value === "string") result[key] = value.slice(0, limit);
    }
    const stackExhausted = data("stackExhausted");
    if (typeof stackExhausted === "boolean") result.stackExhausted = stackExhausted;
    const cause = data("cause");
    if (cause !== undefined) result.cause = failureSnapshot(cause, depth + 1, seen);
    return result;
  } catch { return { kind: "uninspectable" }; }
}

export function runtimeFailure(id: number, phase: string, error: unknown): void {
  if (process.env.PREPARED_MEASUREMENT_MODE !== "exploratory-current") return;
  try { writeCheckpoint(id, phase, "failed", undefined, failureSnapshot(error)); }
  catch { diagnosticFailure(id, phase, "failed"); }
}

export function beginRuntimeDiagnostic(operation: "create" | "replace" | "request"): number {
  const id = ++activation;
  runtimeCheckpoint(id, operation, "start");
  return id;
}

export function runtimeCheckpoint(id: number, phase: string, edge: DiagnosticEdge, detail?: string): void {
  // Only the explicit remote exploratory process writes these records. Normal
  // package checks on this diagnostic source retain the ordinary runtime path.
  if (process.env.PREPARED_MEASUREMENT_MODE !== "exploratory-current") return;
  try { writeCheckpoint(id, phase, edge, detail); }
  catch { diagnosticFailure(id, phase, edge); }
}

function diagnosticFailure(id: number, phase: string, edge: string): void {
    // Observability cannot change a product outcome or prevent its cleanup. A
    // failed probe invalidates this diagnostic process separately, even if both
    // evidence channels fail. The supervisor retains the nonzero process exit.
    process.exitCode = 1;
    const marker = JSON.stringify({ format: "thesmos/cold-runtime-diagnostic-failure/1", activation: id, phase, edge });
    try { appendFileSync(join(process.env.RUNNER_TEMP ?? ".", "prepared-spaces", "runtime-diagnostic-failures.ndjson"), marker + "\n"); } catch { /* exit status remains failed */ }
    try { console.error(marker); } catch { /* exit status remains failed */ }
}

// A global sink cannot distinguish interleaved asynchronous owners. Reject the
// telemetry, without refusing the product operation or stealing an active sink.
function claimPreparedScope(id: number): boolean {
  if (process.env.PREPARED_MEASUREMENT_MODE !== "exploratory-current") return false;
  if (activePreparedScope !== undefined) {
    diagnosticFailure(id, "prepared-scope", "concurrent");
    return false;
  }
  activePreparedScope = id;
  return true;
}

function releasePreparedScope(id: number, owned: boolean): void {
  if (!owned) return;
  if (activePreparedScope !== id) {
    diagnosticFailure(id, "prepared-scope", "ownership-changed");
    return;
  }
  activePreparedScope = undefined;
}

function installFactorySink(id: number): () => void {
  if (process.env.PREPARED_MEASUREMENT_MODE !== "exploratory-current") return () => {};
  // The paired temporary logos source reads this private symbol. No source or
  // runtime graph is passed through it; only this numeric activation is captured.
  const key = Symbol.for("logos.prepared.factory.phase-diagnostic");
  const sink = (phase: string, edge: "start" | "complete" | "failed") => {
    if (!["load-searcher", "program-open", "base-open"].includes(phase) ||
        !["start", "complete", "failed"].includes(edge)) {
      diagnosticFailure(id, "factory-sink", "invalid-event");
      return;
    }
    runtimeCheckpoint(id, `logos-${phase}`, edge);
  };
  let previous: PropertyDescriptor | undefined;
  let installed = false;
  try {
    previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value: sink, writable: true, configurable: true });
    installed = true;
  } catch { diagnosticFailure(id, "factory-sink", "install-failed"); }
  return () => {
    if (!installed) return;
    try {
      const current = Object.getOwnPropertyDescriptor(globalThis, key);
      if (current?.value !== sink) {
        diagnosticFailure(id, "factory-sink", "ownership-changed");
        return;
      }
      if (previous) Object.defineProperty(globalThis, key, previous);
      else if (!Reflect.deleteProperty(globalThis, key)) throw new Error("Diagnostic sink could not be removed");
    } catch { diagnosticFailure(id, "factory-sink", "restore-failed"); }
  };
}

const nativePhaseLabels = [
  "not-entered", "entry", "wire-decode", "envelope-read", "program-parse",
  "envelope-drop", "rule-copy", "compile-index", "program-digest", "publication",
  "program-reply", "reply-encode", "complete",
  "base-payload", "base-bindings", "base-options", "base-session-open",
  "base-prepare", "base-snapshot", "base-publication", "base-reply",
  "request-payload", "request-bindings", "request-facts", "request-fragments",
  "request-instantiate", "request-effective", "request-snapshot-limits", "request-publication", "request-reply",
  "admit-payload", "admit-options", "admit-prepare", "admit-engine", "admit-result",
  "admit-manifest", "admit-manifest-copy", "admit-publication", "admit-reply",
] as const;

function installNativeSink(id: number): () => void {
  if (process.env.PREPARED_MEASUREMENT_MODE !== "exploratory-current") return () => {};
  // A separate private hook observes the last scalar stored on the exact trapped
  // instance after cleanup. There is no per-call nonce: a trap before ENTRY may
  // leave an earlier call's store. This is neither current-call entry proof nor
  // a start/end event or stage duration measurement.
  const key = Symbol.for("logos.prepared.native-phase-diagnostic");
  const sink = (status: unknown, phase: unknown) => {
    if (status === "observed") {
      if (typeof phase !== "number" || !Number.isInteger(phase) || phase < 0 || phase >= nativePhaseLabels.length) {
        diagnosticFailure(id, "native-sink", "invalid-event");
        return;
      }
      runtimeCheckpoint(id, "logos-native-prepared", status, `phaseCode=${phase}; phaseLabel=${nativePhaseLabels[phase]}`);
    } else if ((status === "unavailable" || status === "read-failed" || status === "invalid") && phase === undefined) {
      runtimeCheckpoint(id, "logos-native-prepared", status);
    } else {
      diagnosticFailure(id, "native-sink", "invalid-event");
    }
  };
  let previous: PropertyDescriptor | undefined;
  let installed = false;
  try {
    previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value: sink, writable: true, configurable: true });
    installed = true;
  } catch { diagnosticFailure(id, "native-sink", "install-failed"); }
  return () => {
    if (!installed) return;
    try {
      const current = Object.getOwnPropertyDescriptor(globalThis, key);
      if (current?.value !== sink) {
        diagnosticFailure(id, "native-sink", "ownership-changed");
        return;
      }
      if (previous) Object.defineProperty(globalThis, key, previous);
      else if (!Reflect.deleteProperty(globalThis, key)) throw new Error("Native diagnostic sink could not be removed");
    } catch { diagnosticFailure(id, "native-sink", "restore-failed"); }
  };
}

const preparedOperations = ["program_open", "base_open", "request_open", "admit", "execute", "materialize", "close", "diagnostics", "unknown"];
const preparedPhases = ["guards", "encode", "post-encode-guards", "input-buffer", "export-call", "reply", "complete"];

function installOperationSink(id: number): () => void {
  if (process.env.PREPARED_MEASUREMENT_MODE !== "exploratory-current") return () => {};
  const key = Symbol.for("logos.prepared.operation-diagnostic");
  // Only primitive labels and the numeric activation cross this private hook.
  const sink = function (operation: unknown, phase: unknown, outcome: unknown) {
    if (arguments.length !== 3 || typeof operation !== "string" || !preparedOperations.includes(operation) ||
        typeof phase !== "string" || !preparedPhases.includes(phase) ||
        (phase === "complete" ? outcome !== "returned" : outcome !== "threw")) {
      diagnosticFailure(id, "operation-sink", "invalid-event");
      return;
    }
    runtimeCheckpoint(id, "logos-prepared-operation", "observed", `operation=${operation}; transportPhase=${phase}; outcome=${outcome}`);
  };
  let previous: PropertyDescriptor | undefined;
  let installed = false;
  try {
    previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value: sink, writable: true, configurable: true });
    installed = true;
  } catch { diagnosticFailure(id, "operation-sink", "install-failed"); }
  return () => {
    if (!installed) return;
    try {
      const current = Object.getOwnPropertyDescriptor(globalThis, key);
      if (current?.value !== sink) {
        diagnosticFailure(id, "operation-sink", "ownership-changed");
        return;
      }
      if (previous) Object.defineProperty(globalThis, key, previous);
      else if (!Reflect.deleteProperty(globalThis, key)) throw new Error("Operation diagnostic sink could not be removed");
    } catch { diagnosticFailure(id, "operation-sink", "restore-failed"); }
  };
}

/** Keep both sinks active through the actual request and its product cleanup. */
export async function diagnosticRequest<T>(operation: () => Promise<T>): Promise<T> {
  const id = beginRuntimeDiagnostic("request");
  const owned = claimPreparedScope(id);
  const restoreNative = owned ? installNativeSink(id) : noSink;
  const restoreOperation = owned ? installOperationSink(id) : noSink;
  try {
    const result = await operation();
    runtimeCheckpoint(id, "request", "complete");
    return result;
  } catch (error) {
    runtimeFailure(id, "request", error);
    throw error;
  } finally {
    try { restoreOperation(); }
    finally { try { restoreNative(); } finally { releasePreparedScope(id, owned); } }
  }
}

function writeCheckpoint(id: number, phase: string, edge: DiagnosticEdge, detail?: string, failure?: FailureSnapshot): void {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP ||
      !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") || !process.env.GITHUB_EVENT_PATH ||
      JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).inputs?.mode !== "profile-current" ||
      !/^[a-f0-9]{40}$/.test(process.env.LOGOS_REVISION ?? "") ||
      !/^[a-f0-9]{40}$/.test(process.env.THESMOS_REVISION ?? "") ||
      !/^[a-f0-9]{64}$/.test(process.env.PREPARED_BUILD_RECEIPT_SHA256 ?? ""))
    throw new Error("Cold runtime checkpoints require the exact-source remote diagnostic route");
  const record = {
    format: "thesmos/cold-runtime-phase/1", sequence: ++sequence, activation: id, phase, edge,
    at: new Date().toISOString(), elapsedMs: performance.now(), pid: process.pid,
    source: { logos: process.env.LOGOS_REVISION, thesmos: process.env.THESMOS_REVISION },
    run: process.env.GITHUB_RUN_ID, buildReceiptSha256: process.env.PREPARED_BUILD_RECEIPT_SHA256,
    memory: process.memoryUsage(), resource: process.resourceUsage(), heapLimit: getHeapStatistics().heap_size_limit,
    ...(detail ? { detail } : {}),
    ...(failure ? { failure } : {}),
  };
  appendFileSync(join(process.env.RUNNER_TEMP, "prepared-spaces", "runtime-phases.ndjson"), JSON.stringify(record) + "\n");
  console.log(JSON.stringify({ runtimePhase: phase, edge, activation: id, heapUsed: record.memory.heapUsed,
    rss: record.memory.rss, heapLimit: record.heapLimit }));
}

export function runtimePhase<T>(id: number, phase: string, operation: () => T): T {
  runtimeCheckpoint(id, phase, "start");
  try {
    const result = operation();
    runtimeCheckpoint(id, phase, "complete");
    return result;
  } catch (error) {
    runtimeFailure(id, phase, error);
    throw error;
  }
}

/** Entry occurs only after Session's isolation capture, without capturing another graph. */
export function diagnosticFactory(id: number, factory: PreparedViewFactory): PreparedViewFactory {
  return {
    async prepare(input) {
      const owned = claimPreparedScope(id);
      const restoreSink = owned ? installFactorySink(id) : noSink;
      const restoreNativeSink = owned ? installNativeSink(id) : noSink;
      const restoreOperationSink = owned ? installOperationSink(id) : noSink;
      runtimeCheckpoint(id, "factory-prepare", "start");
      try {
        // Invoke the actual receiver; the wrapper owns neither the input nor the
        // returned runtime, and changes no close/publication responsibility.
        const runtime = await factory.prepare(input);
        runtimeCheckpoint(id, "factory-prepare", "complete");
        return runtime;
      } catch (error) {
        runtimeFailure(id, "factory-prepare", error);
        throw error;
      } finally {
        try { restoreOperationSink(); }
        finally {
          try { restoreNativeSink(); }
          finally { try { restoreSink(); } finally { releasePreparedScope(id, owned); } }
        }
      }
    },
  };
}
