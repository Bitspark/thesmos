// Temporary source-bound instrumentation on runtime-cold-phase-diagnostic only.
// This branch is not a release candidate and this module is not a public API.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";
import type { PreparedViewFactory } from "@bitspark/logos-kernel";

let sequence = 0;
let activation = 0;
type DiagnosticEdge = "start" | "complete" | "failed" | "observed" | "unavailable" | "read-failed" | "invalid";

export function beginRuntimeDiagnostic(operation: "create" | "replace"): number {
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
] as const;

function installNativeSink(id: number): () => void {
  if (process.env.PREPARED_MEASUREMENT_MODE !== "exploratory-current") return () => {};
  // A separate private hook observes the last scalar stage after trapped-call
  // cleanup. This is neither a start/end event nor a stage duration measurement.
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

function writeCheckpoint(id: number, phase: string, edge: DiagnosticEdge, detail?: string): void {
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
    runtimeCheckpoint(id, phase, "failed", "The runtime operation threw; its original exception is preserved");
    throw error;
  }
}

/** Entry occurs only after Session's isolation capture, without capturing another graph. */
export function diagnosticFactory(id: number, factory: PreparedViewFactory): PreparedViewFactory {
  return {
    async prepare(input) {
      const restoreSink = installFactorySink(id);
      const restoreNativeSink = installNativeSink(id);
      runtimeCheckpoint(id, "factory-prepare", "start");
      try {
        // Invoke the actual receiver; the wrapper owns neither the input nor the
        // returned runtime, and changes no close/publication responsibility.
        const runtime = await factory.prepare(input);
        runtimeCheckpoint(id, "factory-prepare", "complete");
        return runtime;
      } catch (error) {
        runtimeCheckpoint(id, "factory-prepare", "failed", "Factory preparation threw; its original exception is preserved");
        throw error;
      } finally { restoreNativeSink(); restoreSink(); }
    },
  };
}
