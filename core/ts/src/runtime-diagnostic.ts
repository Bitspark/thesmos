// Temporary source-bound instrumentation on runtime-base-phase-diagnostic only.
// This branch is not a release candidate and this module is not a public API.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";
import type { PreparedViewFactory } from "@bitspark/logos-kernel";
import { createResourceRetention, type ResourceBinding, type SelectedResourceRetention } from "./runtime-resource-retention.js";

let sequence = 0;
let activation = 0;
let resourceSequence = 0;
let resourceRetention: { directory: string; binding: ResourceBinding; sink: SelectedResourceRetention } | undefined;
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

function beginRuntimeDiagnostic(operation: string): number {
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

const resourceModeKey = Symbol.for("logos.prepared.resource-observer.mode");
const resourceSinkKey = Symbol.for("logos.prepared.resource-observer");

function installResourceSink(id: number, lifecycle: string): () => void {
  const mode = process.env.PREPARED_RESOURCE_OBSERVER_MODE;
  // Absence is a separate calibration arm. Do not manufacture a descriptor or
  // silently inherit a foreign mode and call that an uninstrumented process.
  if (mode === undefined) {
    try {
      if (Object.getOwnPropertyDescriptor(globalThis, resourceModeKey) !== undefined ||
          Object.getOwnPropertyDescriptor(globalThis, resourceSinkKey) !== undefined)
        diagnosticFailure(id, "resource-mode", "unexpected-descriptor");
    } catch { diagnosticFailure(id, "resource-mode", "inspect-failed"); }
    return noSink;
  }
  if (mode !== "minimal" && mode !== "compiled-disabled") {
    diagnosticFailure(id, "resource-mode", "invalid-selection");
    return noSink;
  }
  const sink = function (record: unknown): void {
    try {
      // Every selected callback occupies a sequence, including a rejected one.
      // Passing the exact count separately avoids reading any unexpected arg.
      writeResourceObservation(id, lifecycle, record, arguments.length, mode);
    } catch { diagnosticFailure(id, "resource-sink", "invalid-or-unwritten-event"); }
  };
  let previousMode: PropertyDescriptor | undefined, previousSink: PropertyDescriptor | undefined;
  let modeInstalled = false, sinkInstalled = false;
  try {
    previousMode = Object.getOwnPropertyDescriptor(globalThis, resourceModeKey);
    Object.defineProperty(globalThis, resourceModeKey, { value: mode, writable: true, configurable: true, enumerable: false });
    modeInstalled = true;
    previousSink = Object.getOwnPropertyDescriptor(globalThis, resourceSinkKey);
    Object.defineProperty(globalThis, resourceSinkKey, { value: sink, writable: true, configurable: true, enumerable: false });
    sinkInstalled = true;
  } catch { diagnosticFailure(id, "resource-sink", "install-failed"); }
  return () => {
    if (sinkInstalled) {
      try {
        if (Object.getOwnPropertyDescriptor(globalThis, resourceSinkKey)?.value !== sink)
          diagnosticFailure(id, "resource-sink", "ownership-changed");
        else if (previousSink) Object.defineProperty(globalThis, resourceSinkKey, previousSink);
        else if (!Reflect.deleteProperty(globalThis, resourceSinkKey)) throw new Error("Resource sink removal failed");
      } catch { diagnosticFailure(id, "resource-sink", "restore-failed"); }
    }
    if (modeInstalled) {
      try {
        const current = Object.getOwnPropertyDescriptor(globalThis, resourceModeKey);
        if (current?.value !== mode || current.writable !== true || current.configurable !== true || current.enumerable !== false)
          diagnosticFailure(id, "resource-mode", "ownership-changed");
        else if (previousMode) Object.defineProperty(globalThis, resourceModeKey, previousMode);
        else if (!Reflect.deleteProperty(globalThis, resourceModeKey)) throw new Error("Resource mode removal failed");
      } catch { diagnosticFailure(id, "resource-mode", "restore-failed"); }
    }
  };
}

function preparedScope(id: number, lifecycle: string): () => void {
  const owned = claimPreparedScope(id);
  const restoreFactory = owned ? installFactorySink(id) : noSink;
  const restoreNative = owned ? installNativeSink(id) : noSink;
  const restoreOperation = owned ? installOperationSink(id) : noSink;
  const restoreResources = owned ? installResourceSink(id, lifecycle) : noSink;
  return () => {
    try { restoreResources(); }
    finally {
      try { restoreOperation(); }
      finally {
        try { restoreNative(); }
        finally { try { restoreFactory(); } finally { releasePreparedScope(id, owned); } }
      }
    }
  };
}

/** One actual asynchronous operation, including its existing catch/finally cleanup.
 * These windows are diagnostic operation scopes, not Nightyard's public lifecycle timers.
 * An unrelated nested or concurrent call cannot borrow an already-active sink. */
export async function diagnosticPreparedAsync<T>(phase: string, operation: (id: number) => Promise<T>): Promise<T> {
  const id = beginRuntimeDiagnostic(phase);
  const restore = preparedScope(id, phase);
  try {
    const result = await operation(id);
    runtimeCheckpoint(id, phase, "complete");
    return result;
  } catch (error) {
    runtimeFailure(id, phase, error);
    throw error;
  } finally { restore(); }
}

/** Synchronous teardown/inspection stays synchronous and preserves exact thrown values. */
export function diagnosticPreparedSync<T>(phase: string, operation: () => T): T {
  const id = beginRuntimeDiagnostic(phase);
  const restore = preparedScope(id, phase);
  try {
    const result = operation();
    runtimeCheckpoint(id, phase, "complete");
    return result;
  } catch (error) {
    runtimeFailure(id, phase, error);
    throw error;
  } finally { restore(); }
}

/** Admission scope; execution and later retained-witness work have separate windows. */
export function diagnosticRequest<T>(operation: () => Promise<T>): Promise<T> {
  return diagnosticPreparedAsync("request", operation);
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

function writeResourceObservation(id: number, lifecycle: string, observation: unknown, argumentCount: number, mode: string): void {
  const env = process.env;
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || !env.RUNNER_TEMP ||
      !/^\d+$/.test(env.GITHUB_RUN_ID ?? "") || !env.GITHUB_EVENT_PATH ||
      !/^[a-f0-9]{40}$/.test(env.LOGOS_REVISION ?? "") || !/^[a-f0-9]{40}$/.test(env.THESMOS_REVISION ?? "") ||
      !/^[a-f0-9]{64}$/.test(env.PREPARED_BUILD_RECEIPT_SHA256 ?? "") ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(env.PREPARED_OBSERVATION_CAPTURE_ID ?? "") ||
      !/^[a-f0-9]{64}$/.test(env.PREPARED_OBSERVATION_CONFIGURATION_SHA256 ?? "") ||
      !["minimal-diagnostic", "focused-diagnostic"].includes(env.PREPARED_OBSERVATION_EXECUTION_CLASS ?? ""))
    throw new Error("Resource observations require the exact-source remote diagnostic context");
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  if (event.repository?.full_name !== "Bitspark/nightyard" || event.inputs?.mode !== "profile-current")
    throw new Error("Resource observations require the actual profile-current workflow dispatch");
  const context: ResourceBinding = {
    source: { logos: env.LOGOS_REVISION!, thesmos: env.THESMOS_REVISION! }, run: env.GITHUB_RUN_ID!,
    buildReceiptSha256: env.PREPARED_BUILD_RECEIPT_SHA256!, captureId: env.PREPARED_OBSERVATION_CAPTURE_ID!,
    configurationSha256: env.PREPARED_OBSERVATION_CONFIGURATION_SHA256!,
    executionClass: env.PREPARED_OBSERVATION_EXECUTION_CLASS as ResourceBinding["executionClass"],
    pid: process.pid, timeOriginMs: performance.timeOrigin,
  };
  const directory = join(env.RUNNER_TEMP, "prepared-spaces");
  if (resourceRetention === undefined) {
    resourceRetention = { directory, binding: context, sink: createResourceRetention(directory, context) };
    process.once("exit", resourceRetentionExit);
  }
  if (resourceRetention.directory !== directory || JSON.stringify(resourceRetention.binding) !== JSON.stringify(context))
    throw new Error("Resource retention context changed within the selected process");
  let modeMatches = false;
  try {
    const descriptor = observation !== null && typeof observation === "object"
      ? Object.getOwnPropertyDescriptor(observation, "mode") : undefined;
    modeMatches = descriptor !== undefined && "value" in descriptor && descriptor.value === mode;
  } catch { /* Uninspectable callbacks still occupy a rejected sequence below. */ }
  const record = {
    format: "thesmos/prepared-resource-observation/1", sequence: ++resourceSequence,
    activation: id, lifecycle, at: new Date().toISOString(), elapsedMs: performance.now(),
    timeOriginMs: performance.timeOrigin, pid: process.pid,
    source: { logos: env.LOGOS_REVISION, thesmos: env.THESMOS_REVISION },
    run: env.GITHUB_RUN_ID, buildReceiptSha256: env.PREPARED_BUILD_RECEIPT_SHA256,
    captureId: env.PREPARED_OBSERVATION_CAPTURE_ID,
    configurationSha256: env.PREPARED_OBSERVATION_CONFIGURATION_SHA256,
    executionClass: env.PREPARED_OBSERVATION_EXECUTION_CLASS,
    // A bad callback is retained as a coverage gap, never truncated/relabelled.
    observation: argumentCount === 1 && modeMatches ? observation : null,
  };
  if (!resourceRetention.sink.accept(record)) throw new Error("Selected resource evidence was refused or could not be retained");
}

function resourceRetentionExit(code: number): void { finalizePreparedResourceRetention(code); }

// Internal diagnostic finalizer. The actual runtime calls it only from exit;
// focused controls call the same path before removing their owned directory.
// No product callback or cleanup is invoked, retried or swallowed by this hook.
export function finalizePreparedResourceRetention(code: number): void {
  const current = resourceRetention;
  resourceRetention = undefined;
  resourceSequence = 0;
  process.removeListener("exit", resourceRetentionExit);
  if (current === undefined) return;
  try {
    if (!current.sink.finalize(code)) diagnosticFailure(0, "resource-retention", "finalize-failed");
  } catch { diagnosticFailure(0, "resource-retention", "finalize-failed"); }
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

/** Checkpoints inside an explicitly owned outer create/replace scope. Entry occurs only
 * after Session's isolation capture; this adapter neither claims nor borrows global sinks. */
export function diagnosticFactory(id: number, factory: PreparedViewFactory): PreparedViewFactory {
  return {
    async prepare(input) {
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
      }
    },
  };
}
