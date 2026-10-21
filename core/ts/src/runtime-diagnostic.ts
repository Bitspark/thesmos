// Temporary source-bound instrumentation on runtime-cold-phase-diagnostic only.
// This branch is not a release candidate and this module is not a public API.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";

let sequence = 0;
let activation = 0;

export function beginRuntimeDiagnostic(operation: "create" | "replace"): number {
  const id = ++activation;
  runtimeCheckpoint(id, operation, "start");
  return id;
}

export function runtimeCheckpoint(id: number, phase: string, edge: "start" | "complete" | "failed", detail?: string): void {
  // Only the explicit remote exploratory process writes these records. Normal
  // package checks on this diagnostic source retain the ordinary runtime path.
  if (process.env.PREPARED_MEASUREMENT_MODE !== "exploratory-current") return;
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
    runtimeCheckpoint(id, phase, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
