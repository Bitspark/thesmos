import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  Bindings, DatasetSnapshot, Multiplicity, PreparedQuery, PreparedViewLease, Program, Session,
  type PreparedInputs, type PreparedRuntime, type PreparedViewFactory,
} from "@bitspark/logos-kernel";
import { diagnosticFactory as factoryCheckpoints, diagnosticPreparedAsync, diagnosticPreparedSync, diagnosticRequest,
  finalizePreparedResourceRetention, runtimePhase } from "../src/runtime-diagnostic.js";
import { atom, createSpacesVerifier, path } from "../src/index.js";
import { createSpacesRuntime, type SpacesRuntimeDecision } from "../src/runtime.js";
import { copyPreparedResourceRecord, type PreparedResourceRecord } from "../src/runtime-resource-observation.js";

// Factory checkpointing runs inside the same explicit outer ownership scope used by
// runtime creation/replacement. This fixture owns no input or returned runtime.
function diagnosticFactory(id: number, factory: PreparedViewFactory): PreparedViewFactory {
  return { prepare: input => diagnosticPreparedAsync("factory-control", () => factoryCheckpoints(id, factory).prepare(input)) };
}

test("failed diagnostic validation preserves successful results and original exceptions", () => {
  const previousMode = process.env.PREPARED_MEASUREMENT_MODE;
  const previousEvent = process.env.GITHUB_EVENT_PATH;
  const previousTemporary = process.env.RUNNER_TEMP;
  const previousExit = process.exitCode;
  try {
    process.env.PREPARED_MEASUREMENT_MODE = "exploratory-current";
    delete process.env.GITHUB_EVENT_PATH;
    // Both the primary checkpoint and fallback sidecar must fail. The process
    // status still invalidates telemetry without interfering with the operation.
    process.env.RUNNER_TEMP = "/dev/null/not-a-directory";
    const owned = { value: "same object" };
    assert.equal(runtimePhase(1, "synthetic-operation", () => owned), owned);
    assert.equal(process.exitCode, 1);
    const original = new Error("original operation failure");
    assert.throws(() => runtimePhase(1, "synthetic-failure", () => { throw original; }), error => error === original);
  } finally {
    for (const [name, value] of [["PREPARED_MEASUREMENT_MODE", previousMode], ["GITHUB_EVENT_PATH", previousEvent],
      ["RUNNER_TEMP", previousTemporary]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    process.exitCode = previousExit;
  }
});

test("factory phase failures preserve receiver, input, resolved runtime and rejected error identity", async () => {
  const previousMode = process.env.PREPARED_MEASUREMENT_MODE;
  const previousEvent = process.env.GITHUB_EVENT_PATH;
  const previousTemporary = process.env.RUNNER_TEMP;
  const previousExit = process.exitCode;
  try {
    process.env.PREPARED_MEASUREMENT_MODE = "exploratory-current";
    delete process.env.GITHUB_EVENT_PATH;
    process.env.RUNNER_TEMP = "/dev/null/not-a-directory";
    const input: PreparedInputs = { snapshot: DatasetSnapshot.resolve(Program.empty(), Bindings.empty()), multiplicity: Multiplicity.Set };
    let calls = 0, closed = 0;
    const runtime: PreparedRuntime = { async request() { throw new Error("This control does not run requests"); }, close() { closed++; } };
    let resolve!: (value: PreparedRuntime) => void;
    const pending = new Promise<PreparedRuntime>(complete => { resolve = complete; });
    const factory: PreparedViewFactory = {
      prepare(received) {
        assert.equal(this, factory);
        assert.equal(received, input);
        calls++;
        return pending;
      },
    };
    const result = diagnosticFactory(2, factory).prepare(input);
    assert.equal(calls, 1);
    assert.equal(closed, 0);
    resolve(runtime);
    assert.equal(await result, runtime);
    assert.equal(closed, 0);
    assert.equal(process.exitCode, 1);
    const original = new Error("original asynchronous factory failure");
    const failed: PreparedViewFactory = {
      prepare(received) {
        assert.equal(this, failed);
        assert.equal(received, input);
        return Promise.reject(original);
      },
    };
    await assert.rejects(diagnosticFactory(3, failed).prepare(input), error => error === original);
    runtime.close();
    assert.equal(closed, 1);
  } finally {
    for (const [name, value] of [["PREPARED_MEASUREMENT_MODE", previousMode], ["GITHUB_EVENT_PATH", previousEvent],
      ["RUNNER_TEMP", previousTemporary]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    process.exitCode = previousExit;
  }
});

test("temporary factory sink restores its exact descriptor and never overwrites another owner", async () => {
  const key = Symbol.for("logos.prepared.factory.phase-diagnostic");
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  const previousMode = process.env.PREPARED_MEASUREMENT_MODE;
  const previousEvent = process.env.GITHUB_EVENT_PATH;
  const previousTemporary = process.env.RUNNER_TEMP;
  const previousExit = process.exitCode;
  try {
    process.env.PREPARED_MEASUREMENT_MODE = "exploratory-current";
    delete process.env.GITHUB_EVENT_PATH;
    process.env.RUNNER_TEMP = "/dev/null/not-a-directory";
    Object.defineProperty(globalThis, key, { get() { throw new Error("The diagnostic must not invoke a previous getter"); }, configurable: true, enumerable: true });
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    const input: PreparedInputs = { snapshot: DatasetSnapshot.resolve(Program.empty(), Bindings.empty()), multiplicity: Multiplicity.Set };
    const runtime: PreparedRuntime = { async request() { throw new Error("No request in this control"); }, close() {} };
    const factory: PreparedViewFactory = { async prepare(received) {
      assert.equal(received, input);
      assert.equal(this, factory);
      const sink = Object.getOwnPropertyDescriptor(globalThis, key)?.value as (phase: string, edge: string) => void;
      assert.equal(typeof sink, "function");
      sink("program-open", "start");
      sink("program-open", "complete");
      return runtime;
    } };
    assert.equal(await diagnosticFactory(4, factory).prepare(input), runtime);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), previous);
    const rejection = new Error("original factory rejection");
    await assert.rejects(diagnosticFactory(5, { async prepare() { throw rejection; } }).prepare(input), error => error === rejection);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), previous);
    const anotherOwner = () => {};
    const changed: PreparedViewFactory = { async prepare() {
      Object.defineProperty(globalThis, key, { value: anotherOwner, configurable: true });
      return runtime;
    } };
    assert.equal(await diagnosticFactory(6, changed).prepare(input), runtime);
    assert.equal(Object.getOwnPropertyDescriptor(globalThis, key)?.value, anotherOwner);
    assert.equal(process.exitCode, 1);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, key, originalDescriptor);
    else Reflect.deleteProperty(globalThis, key);
    for (const [name, value] of [["PREPARED_MEASUREMENT_MODE", previousMode], ["GITHUB_EVENT_PATH", previousEvent],
      ["RUNNER_TEMP", previousTemporary]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    process.exitCode = previousExit;
  }
});

test("native phase observations validate only scalar stages and preserve errors and sink ownership", async () => {
  const key = Symbol.for("logos.prepared.native-phase-diagnostic");
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  const previousMode = process.env.PREPARED_MEASUREMENT_MODE;
  const previousEvent = process.env.GITHUB_EVENT_PATH;
  const previousTemporary = process.env.RUNNER_TEMP;
  const previousExit = process.exitCode;
  const previousConsoleError = console.error;
  const markers: { phase: string; edge: string }[] = [];
  try {
    process.env.PREPARED_MEASUREMENT_MODE = "exploratory-current";
    delete process.env.GITHUB_EVENT_PATH;
    process.env.RUNNER_TEMP = "/dev/null/not-a-directory";
    console.error = (value: unknown) => { markers.push(JSON.parse(String(value))); };
    Object.defineProperty(globalThis, key, { get() { throw new Error("The native observer must not invoke a previous getter"); }, configurable: true, enumerable: true });
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    const input: PreparedInputs = { snapshot: DatasetSnapshot.resolve(Program.empty(), Bindings.empty()), multiplicity: Multiplicity.Set };
    const runtime: PreparedRuntime = { async request() { throw new Error("No request in this control"); }, close() {} };
    const factory: PreparedViewFactory = { async prepare(received) {
      assert.equal(this, factory);
      assert.equal(received, input);
      const sink = Object.getOwnPropertyDescriptor(globalThis, key)?.value as (status: unknown, phase?: unknown) => void;
      assert.equal(typeof sink, "function");
      for (let phase = 0; phase <= 38; phase++) sink("observed", phase);
      for (const status of ["unavailable", "read-failed", "invalid"]) sink(status);
      assert.equal(markers.filter(marker => marker.phase === "logos-native-prepared" && marker.edge === "observed").length, 39);
      assert.deepEqual(markers.filter(marker => marker.phase === "logos-native-prepared" && marker.edge !== "observed").map(marker => marker.edge), ["unavailable", "read-failed", "invalid"]);
      for (const [status, phase] of [["observed", -1], ["observed", 39], ["observed", 0.5], ["observed", "4"], ["observed", undefined], ["unavailable", 4], ["unknown", undefined]]) sink(status, phase);
      assert.equal(markers.filter(marker => marker.phase === "native-sink" && marker.edge === "invalid-event").length, 7);
      return runtime;
    } };
    assert.equal(await diagnosticFactory(7, factory).prepare(input), runtime);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), previous);
    const rejection = new Error("original trapped factory rejection");
    await assert.rejects(diagnosticFactory(8, { async prepare() { throw rejection; } }).prepare(input), error => error === rejection);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), previous);
    const anotherOwner = () => {};
    const changed: PreparedViewFactory = { async prepare() {
      Object.defineProperty(globalThis, key, { value: anotherOwner, configurable: true });
      return runtime;
    } };
    assert.equal(await diagnosticFactory(9, changed).prepare(input), runtime);
    assert.equal(Object.getOwnPropertyDescriptor(globalThis, key)?.value, anotherOwner);
    assert.ok(markers.some(marker => marker.phase === "native-sink" && marker.edge === "ownership-changed"));
    assert.equal(process.exitCode, 1);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, key, originalDescriptor);
    else Reflect.deleteProperty(globalThis, key);
    console.error = previousConsoleError;
    for (const [name, value] of [["PREPARED_MEASUREMENT_MODE", previousMode], ["GITHUB_EVENT_PATH", previousEvent],
      ["RUNNER_TEMP", previousTemporary]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    process.exitCode = previousExit;
  }
});

test("native phase sink serializes exact fixed labels in the actual remote diagnostic context", async () => {
  // This temporary test is required by the paired profile workflow. It does not
  // invent a runner identity or convert another workflow into a diagnostic run.
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.match(process.env.GITHUB_RUN_ID ?? "", /^\d+$/);
  assert.equal(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")).inputs.mode, "profile-current");
  assert.match(process.env.LOGOS_REVISION ?? "", /^[a-f0-9]{40}$/);
  assert.match(process.env.THESMOS_REVISION ?? "", /^[a-f0-9]{40}$/);
  const previousTemporary = process.env.RUNNER_TEMP;
  assert.ok(previousTemporary);
  const directory = mkdtempSync(join(previousTemporary, "native-phase-receipt-control-"));
  const previousMode = process.env.PREPARED_MEASUREMENT_MODE;
  const previousReceipt = process.env.PREPARED_BUILD_RECEIPT_SHA256;
  const previousExit = process.exitCode;
  const previousConsoleLog = console.log;
  try {
    mkdirSync(join(directory, "prepared-spaces"));
    process.env.RUNNER_TEMP = directory;
    process.env.PREPARED_MEASUREMENT_MODE = "exploratory-current";
    // Unit records stay in this disposable directory; this marker is not a
    // candidate build receipt and cannot authorize the later measured process.
    process.env.PREPARED_BUILD_RECEIPT_SHA256 = createHash("sha256").update("native phase receipt unit control").digest("hex");
    console.log = () => {};
    const labels = ["not-entered", "entry", "wire-decode", "envelope-read", "program-parse", "envelope-drop",
      "rule-copy", "compile-index", "program-digest", "publication", "program-reply", "reply-encode", "complete",
      "base-payload", "base-bindings", "base-options", "base-session-open", "base-prepare", "base-snapshot", "base-publication", "base-reply",
      "request-payload", "request-bindings", "request-facts", "request-fragments", "request-instantiate", "request-effective",
      "request-snapshot-limits", "request-publication", "request-reply", "admit-payload", "admit-options", "admit-prepare",
      "admit-engine", "admit-result", "admit-manifest", "admit-manifest-copy", "admit-publication", "admit-reply"];
    const key = Symbol.for("logos.prepared.native-phase-diagnostic");
    const input: PreparedInputs = { snapshot: DatasetSnapshot.resolve(Program.empty(), Bindings.empty()), multiplicity: Multiplicity.Set };
    const runtime: PreparedRuntime = { async request() { throw new Error("No request in this control"); }, close() {} };
    const factory: PreparedViewFactory = { async prepare() {
      const sink = Object.getOwnPropertyDescriptor(globalThis, key)?.value as (status: string, phase?: number) => void;
      for (let code = 0; code < labels.length; code++) sink("observed", code);
      for (const status of ["unavailable", "read-failed", "invalid"]) sink(status);
      return runtime;
    } };
    assert.equal(await diagnosticFactory(10, factory).prepare(input), runtime);
    assert.equal(process.exitCode, previousExit);
    const records = readFileSync(join(directory, "prepared-spaces", "runtime-phases.ndjson"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const native = records.filter(record => record.phase === "logos-native-prepared");
    assert.equal(native.length, 42);
    for (const [code, label] of labels.entries()) {
      assert.equal(native[code].edge, "observed");
      assert.equal(native[code].detail, `phaseCode=${code}; phaseLabel=${label}`);
    }
    for (const [offset, status] of ["unavailable", "read-failed", "invalid"].entries()) {
      assert.equal(native[39 + offset].edge, status);
      assert.equal(Object.hasOwn(native[39 + offset], "detail"), false);
    }
    for (const record of native) {
      assert.equal(record.run, process.env.GITHUB_RUN_ID);
      assert.deepEqual(record.source, { logos: process.env.LOGOS_REVISION, thesmos: process.env.THESMOS_REVISION });
      assert.equal(record.buildReceiptSha256, process.env.PREPARED_BUILD_RECEIPT_SHA256);
    }
  } finally {
    console.log = previousConsoleLog;
    for (const [name, value] of [["PREPARED_MEASUREMENT_MODE", previousMode], ["RUNNER_TEMP", previousTemporary],
      ["PREPARED_BUILD_RECEIPT_SHA256", previousReceipt]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    process.exitCode = previousExit;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed phase records bounded primitive causes without replacing the thrown object or invoking getters", () => {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.match(process.env.GITHUB_RUN_ID ?? "", /^\d+$/);
  assert.equal(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")).inputs.mode, "profile-current");
  assert.match(process.env.LOGOS_REVISION ?? "", /^[a-f0-9]{40}$/);
  assert.match(process.env.THESMOS_REVISION ?? "", /^[a-f0-9]{40}$/);
  const previousTemporary = process.env.RUNNER_TEMP;
  assert.ok(previousTemporary);
  const directory = mkdtempSync(join(previousTemporary, "runtime-error-receipt-control-"));
  const previousMode = process.env.PREPARED_MEASUREMENT_MODE;
  const previousReceipt = process.env.PREPARED_BUILD_RECEIPT_SHA256;
  const previousExit = process.exitCode;
  const previousConsoleLog = console.log;
  try {
    mkdirSync(join(directory, "prepared-spaces"));
    process.env.RUNNER_TEMP = directory;
    process.env.PREPARED_MEASUREMENT_MODE = "exploratory-current";
    process.env.PREPARED_BUILD_RECEIPT_SHA256 = createHash("sha256").update("runtime failure receipt unit control").digest("hex");
    console.log = () => {};
    const cause = new Error("original native unreachable");
    const original = Object.assign(new Error("original enriched guest trap", { cause }), {
      name: "GuestTrap", observed: "trap_observation", stackExhausted: false,
      program: { mustNeverBeRecorded: true },
    });
    // Inspect only a data descriptor; V8 may expose lazy stacks as accessors.
    Object.defineProperty(original, "stack", { value: "GuestTrap: original enriched guest trap\n at diagnostic boundary", configurable: true });
    assert.throws(() => runtimePhase(11, "synthetic-failure", () => { throw original; }), error => error === original);
    let getterCalls = 0;
    const getter = Object.defineProperties({}, {
      name: { get() { getterCalls++; throw new Error("must not run"); } },
      cause: { get() { getterCalls++; throw new Error("must not run"); } },
    });
    assert.throws(() => runtimePhase(12, "synthetic-getter", () => { throw getter; }), error => error === getter);
    const inaccessible = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("uninspectable"); } });
    assert.throws(() => runtimePhase(13, "synthetic-proxy", () => { throw inaccessible; }), error => error === inaccessible);
    const cyclic: { name: string; message: string; stack: string; observed: string; cause?: unknown } = {
      name: "n".repeat(256), message: "m".repeat(8192), stack: "s".repeat(32768), observed: "o".repeat(2048),
    };
    cyclic.cause = cyclic;
    assert.throws(() => runtimePhase(14, "synthetic-cycle", () => { throw cyclic; }), error => error === cyclic);
    let deep: unknown = new Error("deep cause");
    for (let index = 0; index < 8; index++) deep = { cause: deep };
    assert.throws(() => runtimePhase(15, "synthetic-depth", () => { throw deep; }), error => error === deep);
    assert.equal(getterCalls, 0);
    assert.equal(process.exitCode, previousExit);
    const records = readFileSync(join(directory, "prepared-spaces", "runtime-phases.ndjson"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const failures = records.filter(record => record.edge === "failed");
    assert.equal(failures.length, 5);
    assert.equal(failures[0].failure.name, "GuestTrap");
    assert.equal(failures[0].failure.message, original.message);
    assert.equal(failures[0].failure.stack, original.stack);
    assert.equal(failures[0].failure.observed, original.observed);
    assert.equal(failures[0].failure.stackExhausted, false);
    assert.equal(failures[0].failure.cause.message, cause.message);
    assert.equal(JSON.stringify(failures).includes("mustNeverBeRecorded"), false);
    assert.deepEqual(failures[1].failure, { kind: "object" });
    assert.deepEqual(failures[2].failure, { kind: "uninspectable" });
    assert.equal(failures[3].failure.name.length, 128);
    assert.equal(failures[3].failure.message.length, 4096);
    assert.equal(failures[3].failure.stack.length, 16384);
    assert.equal(failures[3].failure.observed.length, 1024);
    assert.deepEqual(failures[3].failure.cause, { kind: "cycle" });
    assert.deepEqual(failures[4].failure.cause.cause.cause.cause, { kind: "depth-limit" });
    for (const record of failures) {
      assert.equal(record.run, process.env.GITHUB_RUN_ID);
      assert.deepEqual(record.source, { logos: process.env.LOGOS_REVISION, thesmos: process.env.THESMOS_REVISION });
      assert.equal(record.buildReceiptSha256, process.env.PREPARED_BUILD_RECEIPT_SHA256);
    }
  } finally {
    console.log = previousConsoleLog;
    for (const [name, value] of [["PREPARED_MEASUREMENT_MODE", previousMode], ["RUNNER_TEMP", previousTemporary],
      ["PREPARED_BUILD_RECEIPT_SHA256", previousReceipt]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    process.exitCode = previousExit;
    rmSync(directory, { recursive: true, force: true });
  }
});

const nativeHook = Symbol.for("logos.prepared.native-phase-diagnostic");
const operationHook = Symbol.for("logos.prepared.operation-diagnostic");
const factoryHook = Symbol.for("logos.prepared.factory.phase-diagnostic");
const resourceHook = Symbol.for("logos.prepared.resource-observer");
const resourceModeHook = Symbol.for("logos.prepared.resource-observer.mode");
const resourceEnvironment = ["PREPARED_RESOURCE_OBSERVER_MODE", "PREPARED_OBSERVATION_CAPTURE_ID",
  "PREPARED_OBSERVATION_CONFIGURATION_SHA256", "PREPARED_OBSERVATION_EXECUTION_CLASS"] as const;
type RemoteControl = {
  records(): ReturnType<typeof JSON.parse>[];
  resources(): ReturnType<typeof JSON.parse>[];
  failures(): ReturnType<typeof JSON.parse>[];
  receipt: string;
  directory: string;
};

async function remoteControl(label: string, operation: (control: RemoteControl) => Promise<void>): Promise<void> {
  // Validate the actual maintained controller before changing only disposable
  // output paths and the explicitly non-authoritative unit receipt. No GITHUB
  // environment variable or event payload is invented or replaced here.
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_REPOSITORY, "Bitspark/nightyard");
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.match(process.env.GITHUB_RUN_ID ?? "", /^\d+$/);
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8"));
  assert.equal(event.repository.full_name, "Bitspark/nightyard");
  assert.equal(event.inputs.mode, "profile-current");
  assert.match(process.env.LOGOS_REVISION ?? "", /^[a-f0-9]{40}$/);
  assert.match(process.env.THESMOS_REVISION ?? "", /^[a-f0-9]{40}$/);
  const previousTemporary = process.env.RUNNER_TEMP;
  assert.ok(previousTemporary);
  const directory = mkdtempSync(join(previousTemporary, "prepared-request-receipt-control-"));
  const previousMode = process.env.PREPARED_MEASUREMENT_MODE;
  const previousReceipt = process.env.PREPARED_BUILD_RECEIPT_SHA256;
  const previousExit = process.exitCode;
  const previousLog = console.log, previousError = console.error;
  const priorResourceEnvironment = resourceEnvironment.map(name => [name, process.env[name]] as const);
  const descriptors = [nativeHook, operationHook, factoryHook, resourceHook, resourceModeHook].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const readLines = (name: string) => {
    const file = join(directory, "prepared-spaces", name);
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  };
  try {
    mkdirSync(join(directory, "prepared-spaces"));
    process.env.RUNNER_TEMP = directory;
    process.env.PREPARED_MEASUREMENT_MODE = "exploratory-current";
    const receipt = createHash("sha256").update(`request diagnostic unit control: ${label}`).digest("hex");
    process.env.PREPARED_BUILD_RECEIPT_SHA256 = receipt;
    for (const name of resourceEnvironment) delete process.env[name];
    // Only explicit resource controls opt in. These fixture identities bind the
    // disposable unit records, never a measured process or authoritative build.
    process.env.PREPARED_OBSERVATION_CAPTURE_ID = "10000000-0000-4000-8000-000000000001";
    process.env.PREPARED_OBSERVATION_CONFIGURATION_SHA256 = createHash("sha256").update(`unit configuration: ${label}`).digest("hex");
    process.env.PREPARED_OBSERVATION_EXECUTION_CLASS = "minimal-diagnostic";
    Reflect.deleteProperty(globalThis, resourceHook); Reflect.deleteProperty(globalThis, resourceModeHook);
    console.log = () => {};
    console.error = () => {};
    await operation({ records: () => readLines("runtime-phases.ndjson"), resources: () => readLines("runtime-resources.ndjson"),
      failures: () => readLines("runtime-diagnostic-failures.ndjson"), receipt, directory });
  } finally {
    try {
      finalizePreparedResourceRetention(process.exitCode === undefined ? 0 : Number(process.exitCode));
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    } finally {
      console.log = previousLog; console.error = previousError;
      for (const [name, value] of [["PREPARED_MEASUREMENT_MODE", previousMode], ["RUNNER_TEMP", previousTemporary],
        ["PREPARED_BUILD_RECEIPT_SHA256", previousReceipt], ...priorResourceEnvironment] as const) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      process.exitCode = previousExit;
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function sink(key: symbol): (...args: unknown[]) => void {
  const value: unknown = Object.getOwnPropertyDescriptor(globalThis, key)?.value;
  assert.equal(typeof value, "function");
  return value as (...args: unknown[]) => void;
}

test("operation sink serializes the exact remote grammar and refuses invalid pairs and extra arguments", async () => {
  await remoteControl("operation grammar", async control => {
    const operations = ["program_open", "base_open", "request_open", "admit", "execute", "materialize", "close", "diagnostics", "unknown"];
    const phases = ["guards", "encode", "post-encode-guards", "input-buffer", "export-call", "reply", "complete"];
    const expected: string[] = [];
    let inspected = 0;
    const forbidden = new Proxy({}, { get() { inspected++; throw new Error("diagnostics must not inspect this source"); } });
    const invalid: unknown[][] = [
      ["admit", "complete", "threw"], ["admit", "export-call", "returned"], ["admit", "encode", "solved"],
      ["admit", "inside-guest", "threw"], ["admit; source=extra", "encode", "threw"],
      ["admit", "encode; source=extra", "threw"], [forbidden, "encode", "threw"],
      ["admit", "complete", "returned", forbidden], ["admit", "encode"],
    ];
    const input: PreparedInputs = { snapshot: DatasetSnapshot.resolve(Program.empty(), Bindings.empty()), multiplicity: Multiplicity.Set };
    const runtime: PreparedRuntime = { async request() { throw new Error("No request in this grammar control"); }, close() {} };
    const factory: PreparedViewFactory = { async prepare(received) {
      assert.equal(this, factory); assert.equal(received, input);
      const observe = sink(operationHook);
      for (const operation of operations) for (const phase of phases) {
        const outcome = phase === "complete" ? "returned" : "threw";
        observe(operation, phase, outcome);
        expected.push(`operation=${operation}; transportPhase=${phase}; outcome=${outcome}`);
      }
      for (const args of invalid) assert.doesNotThrow(() => observe(...args));
      return runtime;
    } };
    assert.equal(await diagnosticFactory(700, factory).prepare(input), runtime);
    const records = control.records().filter(record => record.phase === "logos-prepared-operation");
    assert.deepEqual(records.map(record => record.detail), expected);
    assert.equal(records.length, 63);
    for (const record of records) {
      assert.equal(record.format, "thesmos/cold-runtime-phase/1");
      assert.equal(record.edge, "observed"); assert.equal(record.activation, records[0]!.activation);
      assert.equal(Object.hasOwn(record, "failure"), false);
      assert.equal(record.run, process.env.GITHUB_RUN_ID);
      assert.deepEqual(record.source, { logos: process.env.LOGOS_REVISION, thesmos: process.env.THESMOS_REVISION });
      assert.equal(record.buildReceiptSha256, control.receipt);
    }
    assert.equal(inspected, 0);
    assert.equal(process.exitCode, 1);
    assert.equal(control.failures().length, invalid.length);
    assert.ok(control.failures().every(record => record.phase === "operation-sink" && record.edge === "invalid-event"));
  });
});

test("request diagnostics retain both sinks across pending awaits and cleanup and restore exact descriptors", async () => {
  await remoteControl("request lifetime", async control => {
    let getterCalls = 0;
    for (const key of [nativeHook, operationHook]) Object.defineProperty(globalThis, key, {
      get() { getterCalls++; throw new Error("previous getters must not be invoked"); }, configurable: true, enumerable: true,
    });
    const before = [nativeHook, operationHook].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    const gate = deferred<void>();
    const original = new Error("original request failure after await");
    let cleanup = 0;
    let installed: [unknown, unknown] | undefined;
    const pending = diagnosticRequest(async () => {
      installed = [sink(nativeHook), sink(operationHook)];
      try { await gate.promise; throw original; }
      finally {
        assert.equal(sink(nativeHook), installed[0]); assert.equal(sink(operationHook), installed[1]);
        cleanup++;
        sink(operationHook)("close", "complete", "returned");
        sink(nativeHook)("observed", 33);
      }
    });
    const rejected = assert.rejects(pending, error => error === original);
    try {
      await Promise.resolve();
      assert.equal(cleanup, 0);
      assert.equal(sink(nativeHook), installed![0]); assert.equal(sink(operationHook), installed![1]);
      assert.deepEqual(control.records().map(record => [record.phase, record.edge]), [["request", "start"]]);
    } finally { gate.resolve(); await rejected; }
    assert.equal(cleanup, 1);
    for (const [index, key] of [nativeHook, operationHook].entries()) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), before[index]);
    assert.equal(getterCalls, 0);
    const records = control.records();
    assert.deepEqual(records.map(record => [record.phase, record.edge]), [
      ["request", "start"], ["logos-prepared-operation", "observed"], ["logos-native-prepared", "observed"], ["request", "failed"],
    ]);
    assert.equal(new Set(records.map(record => record.activation)).size, 1);
    assert.equal(records[1]!.detail, "operation=close; transportPhase=complete; outcome=returned");
    assert.equal(records[2]!.detail, "phaseCode=33; phaseLabel=admit-engine");
    assert.equal(records[3]!.failure.message, original.message);

    const successGate = deferred<void>(), owned = { identity: "same resolved request object" };
    const success = diagnosticRequest(async () => { await successGate.promise; return owned; });
    assert.equal(typeof sink(operationHook), "function");
    successGate.resolve();
    assert.equal(await success, owned);
    for (const [index, key] of [nativeHook, operationHook].entries()) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), before[index]);
    assert.deepEqual(control.failures(), []);
  });
});

test("request sink ownership changes invalidate telemetry without overwriting successors or the original failure", async () => {
  await remoteControl("request ownership", async control => {
    const before = [nativeHook, operationHook].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    const gate = deferred<void>();
    const original = new Error("primary request rejection");
    const pending = diagnosticRequest(async () => { await gate.promise; throw original; });
    const rejected = assert.rejects(pending, error => error === original);
    const successor = () => {};
    try {
      for (const key of [nativeHook, operationHook]) {
        assert.equal(typeof sink(key), "function");
        Object.defineProperty(globalThis, key, { value: successor, writable: false, configurable: true });
      }
    } finally { gate.resolve(); await rejected; }
    for (const key of [nativeHook, operationHook]) assert.equal(Object.getOwnPropertyDescriptor(globalThis, key)?.value, successor);
    assert.deepEqual(control.failures().map(record => [record.phase, record.edge]), [
      ["operation-sink", "ownership-changed"], ["native-sink", "ownership-changed"],
    ]);
    assert.equal(process.exitCode, 1);
    assert.equal(control.records().find(record => record.phase === "request" && record.edge === "failed")!.failure.message, original.message);
    // A later scope is able to acquire and restore the successor descriptors.
    assert.equal(await diagnosticRequest(async () => "later request"), "later request");
    for (const key of [nativeHook, operationHook]) assert.equal(Object.getOwnPropertyDescriptor(globalThis, key)?.value, successor);
    for (const [index, key] of [nativeHook, operationHook].entries()) {
      const descriptor = before[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
});

test("overlapping asynchronous prepared scopes invalidate telemetry in both completion orders without stealing sinks", async () => {
  await remoteControl("concurrent scopes", async control => {
    for (const olderFirst of [true, false]) {
      const before = [nativeHook, operationHook].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
      const olderGate = deferred<void>(), newerGate = deferred<void>();
      const older = diagnosticRequest(async () => { await olderGate.promise; return "older"; });
      const held = [sink(nativeHook), sink(operationHook)];
      const newer = diagnosticRequest(async () => { await newerGate.promise; return "newer"; });
      try {
        assert.equal(sink(nativeHook), held[0]); assert.equal(sink(operationHook), held[1]);
        assert.equal(process.exitCode, 1);
        if (olderFirst) { olderGate.resolve(); assert.equal(await older, "older"); newerGate.resolve(); assert.equal(await newer, "newer"); }
        else { newerGate.resolve(); assert.equal(await newer, "newer"); olderGate.resolve(); assert.equal(await older, "older"); }
      } finally { olderGate.resolve(); newerGate.resolve(); await Promise.allSettled([older, newer]); }
      for (const [index, key] of [nativeHook, operationHook].entries()) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), before[index]);
    }
    const gate = deferred<void>();
    const input: PreparedInputs = { snapshot: DatasetSnapshot.resolve(Program.empty(), Bindings.empty()), multiplicity: Multiplicity.Set };
    const runtime: PreparedRuntime = { async request() { throw new Error("No native query in this ownership control"); }, close() {} };
    const preparing = diagnosticFactory(701, { async prepare() { await gate.promise; return runtime; } }).prepare(input);
    const factorySink = sink(factoryHook), nativeSink = sink(nativeHook), operationSink = sink(operationHook);
    try {
      assert.equal(await diagnosticRequest(async () => "overlapping factory"), "overlapping factory");
      assert.equal(sink(factoryHook), factorySink); assert.equal(sink(nativeHook), nativeSink); assert.equal(sink(operationHook), operationSink);
    } finally { gate.resolve(); assert.equal(await preparing, runtime); }
    assert.equal(control.failures().length, 3);
    assert.ok(control.failures().every(record => record.phase === "prepared-scope" && record.edge === "concurrent"));
    assert.equal(process.exitCode, 1);
  });
});

test("actual SpacesRuntime request keeps observations active through lease await and admission failure cleanup", async t => {
  await remoteControl("actual request scope", async control => {
    const root = atom("diagnostic-root");
    const runtime = await createSpacesRuntime({ root, bundles: [], authenticate: () => true,
      preparationBudget: { maxBundles: 1, maxClauses: 1000, maxPayloadBytes: 1024 * 1024 } });
    const before = [nativeHook, operationHook].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    const requestMethod = PreparedViewLease.prototype.request;
    const closeMethod = PreparedQuery.prototype.close;
    const gate = deferred<void>(), entered = deferred<void>();
    const original = new Error("constructor admission read failed");
    const queryMarker = "request-graph-must-not-be-recorded";
    let closeCalls = 0;
    let installed: [unknown, unknown] | undefined;
    // test-double: forwarding(the real lease runs after a controlled await; the
    // adapter's admission read then fails and its real query cleanup must run)
    const requestMock = t.mock.method(PreparedViewLease.prototype, "request", async function (
      this: PreparedViewLease, options: Parameters<PreparedViewLease["request"]>[0],
    ) {
      installed = [sink(nativeHook), sink(operationHook)]; entered.resolve();
      await gate.promise;
      return requestMethod.call(this, options);
    });
    const admissionMock = t.mock.method(PreparedQuery.prototype, "admission", () => { throw original; });
    const closeMock = t.mock.method(PreparedQuery.prototype, "close", function (this: PreparedQuery) {
      closeCalls++;
      assert.equal(sink(nativeHook), installed![0]); assert.equal(sink(operationHook), installed![1]);
      return closeMethod.call(this);
    });
    let primaryFailed = false;
    let pending: Promise<unknown> | undefined;
    let rejected: Promise<void> | undefined;
    try {
      const offset = control.records().length;
      pending = runtime.request({ query: { actor: root, statement: atom(queryMarker), space: path() }, observations: [] });
      rejected = assert.rejects(pending, error => error === original);
      await Promise.race([entered.promise, pending.then(
        () => { throw new Error("The request returned before entering its lease"); },
        error => { throw error; },
      )]);
      assert.equal(closeCalls, 0);
      assert.equal(sink(nativeHook), installed![0]); assert.equal(sink(operationHook), installed![1]);
      gate.resolve();
      await rejected;
      assert.equal(requestMock.mock.callCount(), 1); assert.equal(admissionMock.mock.callCount(), 1);
      assert.equal(closeCalls, 1);
      for (const [index, key] of [nativeHook, operationHook].entries()) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), before[index]);
      const records = control.records().slice(offset);
      assert.deepEqual([records[0]!.phase, records[0]!.edge], ["request", "start"]);
      assert.deepEqual([records.at(-1)!.phase, records.at(-1)!.edge], ["request", "failed"]);
      const operations = records.filter(record => record.phase === "logos-prepared-operation").map(record => record.detail);
      for (const name of ["request_open", "admit", "close"]) assert.ok(operations.includes(`operation=${name}; transportPhase=complete; outcome=returned`));
      assert.equal(records.at(-1)!.failure.message, original.message);
      assert.equal(new Set(records.map(record => record.activation)).size, 1);
      assert.equal(JSON.stringify(control.records()).includes(queryMarker), false);
      assert.deepEqual(control.failures(), []);
    } catch (error) { primaryFailed = true; throw error; }
    finally {
      gate.resolve(); await Promise.allSettled([pending, rejected]);
      requestMock.mock.restore(); admissionMock.mock.restore(); closeMock.mock.restore();
      try { runtime.close(); } catch (error) { if (!primaryFailed) throw error; }
    }
  });
});

// This is a shape-only unit fixture, never a measured guest or candidate receipt.
function resourceRecord(mode: "minimal" | "compiled-disabled" = "minimal"): PreparedResourceRecord {
  const words = Array<number>(8960).fill(0);
  words[0] = 0x4c4d4f32; words[1] = 2; words[2] = 35840; words[4] = mode === "minimal" ? 1 : 0;
  words[5] = 1; words[7] = 35840; words[26] = 31;
  words.splice(321, 7, 1056, 33, 32, 384, 4608, 4736, 4);
  // Preserve the exact two words; the forwarding boundary never turns this u64
  // into an imprecise Number or asserts that the unit fixture was observed.
  words[32] = 0xffff_ffff; words[33] = 0xffff_ffff;
  const snapshot = () => ({ status: mode === "minimal" ? "observed" as const : "disabled" as const,
    reason: null, association: mode === "minimal" ? "accepted" as const : "disabled" as const,
    memoryPages: 16, words: [...words], aggregateValid: mode === "minimal", associationValid: mode === "minimal" });
  return {
    schema: "logos/prepared-resource-observation/3", mode, searcher: 7, hostCall: 9, operation: "admit",
    startedGeneration: 1, generation: 1, guestWindow: 3, clock: "performance.now", timeOriginMs: 1000,
    hostMemory: { limitPages: 32, pageBytes: 65536, limitBytes: 32 * 65536 },
    preparedInput: { status: "observed", limitBytes: 123456, reason: null },
    startedAtMs: 2, finishedAtMs: 5,
    guestIdentity: { status: "observed", sha256: "8".repeat(64), hashWallMs: 0.125 },
    wire: { status: "observed", bytes: 128, sha256: "9".repeat(64), hashWallMs: 0.25 },
    phase: "complete", outcome: "returned", encodingReturned: true, inputAllocation: true,
    inputAllocationReturned: true, inputWritten: true, exportEntry: true, firstThrownExport: null,
    exports: [{ export: "logos_prepared", ordinal: 11, outcome: "returned", args: [48, 128], startedAtMs: 3,
      finishedAtMs: 4, before: snapshot(), after: snapshot() }],
    droppedExports: 0, collectorValid: true, collectorWallMs: 0.5, instanceSetupWallMs: 0.1,
  };
}

test("resource records copy exact fixed words and detached containers without conflating validity", () => {
  const original = resourceRecord(), copied = copyPreparedResourceRecord(original);
  assert.deepEqual(copied, original);
  original.exports[0]!.after.words![32] = 0;
  original.exports[0]!.args[0] = 0;
  original.guestIdentity.sha256 = "a".repeat(64);
  original.hostMemory.limitPages = 1;
  original.preparedInput.limitBytes = 1;
  assert.equal(copied.exports[0]!.after.words![32], 0xffff_ffff);
  assert.equal(copied.exports[0]!.after.words![33], 0xffff_ffff);
  assert.deepEqual(copied.exports[0]!.args, [48, 128]);
  assert.equal(copied.guestIdentity.sha256, "8".repeat(64));
  assert.equal(copied.hostMemory.limitPages, 32);
  assert.equal(copied.preparedInput.limitBytes, 123456);
  for (const [status, reason] of [["unavailable", "missing-exports"], ["read-failed", "read-threw"],
    ["invalid", "header"], ["partial", "publication"]] as const) {
    const value = resourceRecord();
    value.collectorValid = false;
    value.exports[0]!.after = { status, reason, association: "not-requested", memoryPages: 4096,
      words: null, aggregateValid: false, associationValid: false };
    const detached = copyPreparedResourceRecord(value);
    assert.deepEqual(detached, value);
    assert.equal(detached.exports[0]!.after.memoryPages, 4096);
    assert.equal(detached.collectorValid, false);
  }
  assert.deepEqual(copyPreparedResourceRecord(resourceRecord("compiled-disabled")), resourceRecord("compiled-disabled"));
});

test("resource record grammar rejects getters holes extra graphs and out-of-domain fields", () => {
  const mutations: ((record: PreparedResourceRecord) => unknown)[] = [
    value => ({ ...value, schema: "other" }), value => ({ ...value, operation: "source-capture" }),
    value => ({ ...value, schema: "logos/prepared-resource-observation/2" }),
    value => { Reflect.deleteProperty(value, "hostMemory"); return value; },
    value => { Reflect.deleteProperty(value, "preparedInput"); return value; },
    ...["limitPages", "pageBytes", "limitBytes"].map(field => (value: PreparedResourceRecord) => {
      Reflect.deleteProperty(value.hostMemory, field); return value;
    }),
    value => ({ ...value, hostMemory: { ...value.hostMemory, limitPages: 0 } }),
    value => ({ ...value, hostMemory: { ...value.hostMemory, limitPages: 1.5 } }),
    value => ({ ...value, hostMemory: { ...value.hostMemory, limitPages: 65537 } }),
    value => ({ ...value, hostMemory: { limitPages: 16385, pageBytes: 65536, limitBytes: 16385 * 65536 } }),
    value => ({ ...value, hostMemory: { ...value.hostMemory, pageBytes: 4096 } }),
    value => ({ ...value, hostMemory: { ...value.hostMemory, limitBytes: value.hostMemory.limitBytes + 1 } }),
    value => ({ ...value, hostMemory: { ...value.hostMemory, limitBytes: Number.MAX_SAFE_INTEGER + 1 } }),
    value => ({ ...value, preparedInput: { ...value.preparedInput, limitBytes: 0 } }),
    value => ({ ...value, preparedInput: { ...value.preparedInput, reason: "missing-export" } }),
    value => ({ ...value, preparedInput: { status: "unavailable", limitBytes: 123456, reason: "missing-export" } }),
    value => ({ ...value, preparedInput: { status: "invalid", limitBytes: null, reason: "export-threw" } }),
    value => ({ ...value, preparedInput: { status: "read-failed", limitBytes: null, reason: "invalid-scalar" } }),
    value => ({ ...value, source: { secret: "must never serialize" } }),
    value => ({ ...value, hostCall: NaN }), value => ({ ...value, generation: 0 }),
    value => ({ ...value, outcome: "threw" }), value => ({ ...value, finishedAtMs: 1 }),
    value => ({ ...value, wire: { ...value.wire, sha256: null } }),
    value => ({ ...value, wire: { status: "not-observed", bytes: 1, sha256: null, hashWallMs: 0 } }),
    value => ({ ...value, exports: Array(17).fill(value.exports[0]) }),
    value => { value.exports[0]!.args.push(0, 0, 0); return value; },
    value => { value.exports[0]!.after.words!.pop(); return value; },
    value => { value.exports[0]!.after.words!.push(0); return value; },
    value => { value.exports[0]!.after.words![0] = 0x1_0000_0000; return value; },
    value => { Reflect.deleteProperty(value.exports[0]!.after.words!, "5"); return value; },
    value => { value.exports[0]!.after.status = "partial"; return value; },
    value => ({ ...value, exports: [{ ...value.exports[0], export: "logos_search" }] }),
  ];
  for (const mutate of mutations) assert.throws(() => copyPreparedResourceRecord(mutate(resourceRecord())), TypeError);
  let invoked = 0;
  for (const field of ["wire", "exports", "collectorWallMs", "hostMemory", "preparedInput"]) {
    const value = resourceRecord();
    Object.defineProperty(value, field, { get() { invoked++; throw new Error("No getters"); }, enumerable: true });
    assert.throws(() => copyPreparedResourceRecord(value), TypeError);
  }
  const value = resourceRecord();
  Object.defineProperty(value.exports[0]!.after.words!, "4", { get() { invoked++; return 0; } });
  assert.throws(() => copyPreparedResourceRecord(value), TypeError);
  for (const [field, key] of [["hostMemory", "limitPages"], ["preparedInput", "limitBytes"]] as const) {
    const nested = resourceRecord();
    Object.defineProperty(nested[field], key, { get() { invoked++; return 1; }, enumerable: true });
    assert.throws(() => copyPreparedResourceRecord(nested), TypeError);
  }
  assert.throws(() => copyPreparedResourceRecord({ ...resourceRecord(), toJSON() { invoked++; return {}; } }), TypeError);
  assert.equal(invoked, 0);
});

test("resource cap and input-guard provenance remain separate from counters and extent", () => {
  for (const mode of ["minimal", "compiled-disabled"] as const) {
    for (const [status, reason] of [["unavailable", "missing-export"], ["unavailable", "instance-not-bound"],
      ["invalid", "invalid-scalar"], ["read-failed", "export-threw"]] as const) {
      const value = resourceRecord(mode);
      value.preparedInput = { status, limitBytes: null, reason };
      assert.deepEqual(copyPreparedResourceRecord(value), value);
    }
    const replacement = resourceRecord(mode);
    replacement.startedGeneration = 2; replacement.generation = 2;
    const detached = copyPreparedResourceRecord(replacement);
    assert.equal(detached.searcher, 7); assert.equal(detached.generation, 2);
    assert.equal(detached.hostMemory.limitPages, 32);
    // A cooperative cap does not rewrite an observed extent or imply that the
    // fixed raw growth fields (all zero in this shape control) observed it.
    replacement.exports[0]!.after.memoryPages = 33;
    assert.equal(copyPreparedResourceRecord(replacement).exports[0]!.after.memoryPages, 33);
    const ceiling = resourceRecord(mode);
    ceiling.hostMemory = { limitPages: 16384, pageBytes: 65536, limitBytes: 16384 * 65536 };
    ceiling.exports[0]!.after.memoryPages = 16385;
    const observed = copyPreparedResourceRecord(ceiling);
    assert.equal(observed.hostMemory.limitPages, 16384, "the exact paired host ceiling remains admissible");
    assert.equal(observed.exports[0]!.after.memoryPages, 16385, "extent remains independent of the cooperative host cap domain");
  }
});

test("resource class matrices retain independent faults and exact detached tail words", () => {
  const value = resourceRecord();
  const words = value.exports[0]!.after.words!;
  words[320] = 4; words[4608] = 1; words[4609] = 2;
  words[8958] = 0xffff_ffff; words[8959] = 0x1234_5678;
  const copy = copyPreparedResourceRecord(value);
  assert.equal(copy.exports[0]!.after.aggregateValid, true, "copier does not erase aggregate validity for a class fault");
  assert.deepEqual(copy.exports[0]!.after.words!.slice(-2), [0xffff_ffff, 0x1234_5678]);
  words[4609] = 0; words[8959] = 0;
  assert.equal(copy.exports[0]!.after.words![4609], 2);
  assert.equal(copy.exports[0]!.after.words![8959], 0x1234_5678);
  const oldLength = resourceRecord(); oldLength.exports[0]!.after.words!.length = 320;
  assert.throws(() => copyPreparedResourceRecord(oldLength), TypeError);
  const hole = resourceRecord(); Reflect.deleteProperty(hole.exports[0]!.after.words!, "8959");
  assert.throws(() => copyPreparedResourceRecord(hole), TypeError);
});

test("resource scopes preserve absence exact descriptors overlap and thrown identity", async () => {
  await remoteControl("resource ownership", async control => {
    const returned = { same: "result" }, primary = new Error("original resource scope failure");
    assert.equal(diagnosticPreparedSync("absent-control", () => {
      assert.equal(Object.getOwnPropertyDescriptor(globalThis, resourceModeHook), undefined);
      assert.equal(Object.getOwnPropertyDescriptor(globalThis, resourceHook), undefined);
      return returned;
    }), returned);
    let foreignGetterCalls = 0;
    Object.defineProperty(globalThis, resourceHook, {
      configurable: true, get() { foreignGetterCalls++; throw new Error("Do not invoke a foreign absent-arm sink"); },
    });
    const foreign = Object.getOwnPropertyDescriptor(globalThis, resourceHook);
    assert.equal(diagnosticPreparedSync("foreign-absent-control", () => returned), returned);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, resourceHook), foreign);
    assert.equal(foreignGetterCalls, 0);
    assert.ok(control.failures().some(record => record.phase === "resource-mode" && record.edge === "unexpected-descriptor"));
    Reflect.deleteProperty(globalThis, resourceHook);
    process.env.PREPARED_RESOURCE_OBSERVER_MODE = "minimal";
    let getters = 0;
    for (const key of [resourceHook, resourceModeHook]) Object.defineProperty(globalThis, key, {
      get() { getters++; throw new Error("Do not call prior accessors"); }, configurable: true, enumerable: true,
    });
    const before = [resourceHook, resourceModeHook].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    const gate = deferred<void>();
    const pending = diagnosticPreparedAsync("request", async () => {
      const held = sink(resourceHook);
      assert.equal(Object.getOwnPropertyDescriptor(globalThis, resourceModeHook)?.value, "minimal");
      assert.equal(diagnosticPreparedSync("reentrant-control", () => returned), returned);
      assert.equal(sink(resourceHook), held);
      await gate.promise;
      held(resourceRecord());
      throw primary;
    });
    const rejected = assert.rejects(pending, error => error === primary);
    gate.resolve(); await rejected;
    for (const [index, key] of [resourceHook, resourceModeHook].entries())
      assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), before[index]);
    assert.equal(getters, 0);
    assert.equal(control.resources().length, 1);
    assert.equal(control.resources()[0]!.lifecycle, "request");
    assert.ok(control.failures().some(record => record.phase === "prepared-scope" && record.edge === "concurrent"));
    const successor = () => {};
    assert.throws(() => diagnosticPreparedSync("changed-resource-owner", () => {
      Object.defineProperty(globalThis, resourceHook, { value: successor, configurable: true });
      Object.defineProperty(globalThis, resourceModeHook, { value: "compiled-disabled", configurable: true });
      throw primary;
    }), error => error === primary);
    assert.equal(Object.getOwnPropertyDescriptor(globalThis, resourceHook)?.value, successor);
    assert.equal(Object.getOwnPropertyDescriptor(globalThis, resourceModeHook)?.value, "compiled-disabled");
    assert.equal(process.exitCode, 1);
  });
});

test("resource forwarding binds actual remote context and refuses malformed or unwritten records without changing results", async () => {
  await remoteControl("resource envelope", async control => {
    process.env.PREPARED_RESOURCE_OBSERVER_MODE = "minimal";
    const same = { returned: true };
    assert.equal(diagnosticPreparedSync("request", () => {
      const observe = sink(resourceHook), record = resourceRecord();
      observe(record); record.exports[0]!.before.words![32] = 0;
      observe({ ...resourceRecord(), mode: "compiled-disabled" });
      observe(resourceRecord(), new Proxy({}, { get() { throw new Error("Extra args must stay unread"); } }));
      observe(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("Uninspectable mode must still create a coverage gap"); } }));
      return same;
    }), same);
    const [record] = control.resources();
    assert.equal(control.resources().length, 1);
    assert.equal(record.format, "thesmos/prepared-resource-observation/1");
    assert.equal(record.run, process.env.GITHUB_RUN_ID); assert.equal(record.pid, process.pid);
    assert.deepEqual(record.source, { logos: process.env.LOGOS_REVISION, thesmos: process.env.THESMOS_REVISION });
    assert.equal(record.buildReceiptSha256, control.receipt);
    assert.equal(record.captureId, process.env.PREPARED_OBSERVATION_CAPTURE_ID);
    assert.equal(record.configurationSha256, process.env.PREPARED_OBSERVATION_CONFIGURATION_SHA256);
    assert.equal(record.executionClass, "minimal-diagnostic");
    assert.equal(record.timeOriginMs, performance.timeOrigin);
    assert.deepEqual(record.observation, resourceRecord());
    assert.ok(control.records().some(phase => phase.activation === record.activation && phase.phase === record.lifecycle));
    assert.equal(control.failures().length, 3);
    const coverage = JSON.parse(readFileSync(join(control.directory, "prepared-spaces", "runtime-resources-coverage.json"), "utf8"));
    assert.equal(coverage.prefix.rows, 1); assert.equal(coverage.observed.invalidRows, 3);
    assert.equal(coverage.prefix.stop, "invalid-row"); assert.equal(coverage.status, "failed");
    assert.equal(coverage.observed.lastSequence, record.sequence + 3);
  });
  await remoteControl("resource unwritten", async control => {
    process.env.PREPARED_RESOURCE_OBSERVER_MODE = "minimal";
    const original = new Error("ordinary exception while the collector cannot write");
    const output = join(control.directory, "prepared-spaces", "runtime-resources.ndjson");
    mkdirSync(output);
    assert.throws(() => diagnosticPreparedSync("request-close", () => {
      try { sink(resourceHook)(resourceRecord()); throw original; }
      finally { sink(operationHook)("close", "complete", "returned"); }
    }), error => error === original);
    assert.equal(control.failures().length, 1);
    assert.ok(control.records().some(phase => phase.detail === "operation=close; transportPhase=complete; outcome=returned"));
    assert.equal(process.exitCode, 1);
    finalizePreparedResourceRetention(1);
    assert.ok(control.failures().some(value => value.phase === "resource-retention" && value.edge === "finalize-failed"));
  });
});

test("selected resource retention finalizes at actual child exit without changing a caught product failure", async () => {
  for (const [productExit, closeFails] of [[7, false], [7, true], [0, true]] as const) await remoteControl(`resource real exit ${productExit} ${closeFails}`, async control => {
    const environment = { ...process.env, PREPARED_RESOURCE_OBSERVER_MODE: "minimal" };
    // The real GitHub context is inherited unchanged. Only this owned output
    // directory and existing fixture identities were selected by remoteControl.
    const moduleUrl = new URL("../src/runtime-diagnostic.js", import.meta.url).href;
    const program = `
      import fs from 'node:fs';
      import { join } from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      import { diagnosticPreparedSync } from ${JSON.stringify(moduleUrl)};
      const record = JSON.parse(fs.readFileSync(0, 'utf8'));
      const productExit = ${productExit}, closeFails = ${closeFails};
      const target = join(process.env.RUNNER_TEMP, 'prepared-spaces', 'runtime-resources-coverage.json');
      const originalOpen = fs.openSync, originalClose = fs.closeSync;
      let coverageFd;
      if (closeFails) {
        fs.openSync = function (...args) {
          const fd = Reflect.apply(originalOpen, this, args);
          if (args[0] === target) coverageFd = fd;
          return fd;
        };
        fs.closeSync = function (fd) {
          if (fd !== coverageFd) return originalClose(fd);
          try { originalClose(fd); }
          finally { fs.openSync = originalOpen; fs.closeSync = originalClose; syncBuiltinESMExports(); }
          process.stderr.write('CONTROL_RESOURCE_CLOSE_AFTER_REAL_CLOSE\\n');
          throw new Error('Controlled late coverage close failure');
        };
        syncBuiltinESMExports();
      }
      const primary = { exact: 'product-failure-control' };
      let cleaned = false;
      try {
        const result = diagnosticPreparedSync('request', () => {
          const sink = Object.getOwnPropertyDescriptor(globalThis, Symbol.for('logos.prepared.resource-observer')).value;
          try { sink(record); if (productExit !== 0) throw primary; return primary; } finally { cleaned = true; }
        });
        if (result !== primary || !cleaned) throw new Error('Product result/cleanup changed');
      } catch (error) {
        if (error !== primary || !cleaned) throw new Error('Product failure/cleanup changed');
        process.exitCode = productExit;
      }
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      env: environment, input: JSON.stringify(resourceRecord()), encoding: "utf8", timeout: 10000, maxBuffer: 65536,
    });
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    assert.equal(child.status, productExit || 1, "late collector failure preserves an already nonzero product exit");
    const coverage = JSON.parse(readFileSync(join(control.directory, "prepared-spaces", "runtime-resources-coverage.json"), "utf8"));
    assert.equal(coverage.prefix.rows, 1); assert.equal(coverage.status, "complete");
    assert.deepEqual(coverage.finalization, { status: "exit-observed", exitCode: productExit });
    assert.equal(coverage.authority.productOutcome, "not-assessed");
    if (closeFails) {
      assert.match(child.stderr, /CONTROL_RESOURCE_CLOSE_AFTER_REAL_CLOSE/);
      assert.deepEqual(control.failures(), [{ format: "thesmos/cold-runtime-diagnostic-failure/1", activation: 0,
        phase: "resource-retention", edge: "finalize-failed" }],
      "the independent failure channel must reject a checkpoint written before the failed close");
    } else {
      assert.doesNotMatch(child.stderr, /CONTROL_RESOURCE_CLOSE_AFTER_REAL_CLOSE/);
      assert.deepEqual(control.failures(), []);
    }
    assert.ok(control.records().some(record => record.phase === "request" && record.edge === (productExit ? "failed" : "complete")));
  });
});

test("actual lifecycle forwards preparation execution replacement retained export and teardown resource records", async () => {
  await remoteControl("actual resource lifecycle", async control => {
    process.env.PREPARED_RESOURCE_OBSERVER_MODE = "minimal";
    const root = atom("resource-root"), marker = "do-not-retain-query-graph-in-resource-records";
    const query = { actor: root, statement: atom(marker), space: path() };
    const runtime = await createSpacesRuntime({ root, bundles: [], authenticate: () => true, memoryLimitPages: 4095,
      preparationBudget: { maxBundles: 1, maxClauses: 1000, maxPayloadBytes: 1024 * 1024 } });
    let request: Awaited<ReturnType<typeof runtime.request>> | undefined;
    let result: SpacesRuntimeDecision | undefined;
    try {
      request = await runtime.request({ query, observations: [] });
      result = await request.run();
      assert.equal(result.kind, "permitted", result.kind === "unsupported" ? result.detail : undefined);
      if (result.kind !== "permitted") throw new Error("The real root authority must produce a retained witness");
      request.close(); request = undefined;
      await runtime.replace([]);
      runtime.close();
      const exported = await result.witness.export();
      assert.equal(exported.kind, "exported");
      if (exported.kind !== "exported") throw new Error("The retained witness must export after owner retirement");
      assert.equal(createSpacesVerifier({ root, authenticate: () => true }).verify({ query, proof: exported.proof }).permitted, true);
      result.witness.close();
      const resources = control.resources();
      for (const [lifecycle, operation] of [["create", "program_open"], ["create", "base_open"],
        ["request", "request_open"], ["request", "admit"], ["request-execute", "execute"],
        ["request-close", "close"], ["replace", "program_open"], ["replace", "base_open"],
        ["runtime-close", "close"], ["witness-export", "materialize"]])
        assert.ok(resources.some(record => record.lifecycle === lifecycle && record.observation.operation === operation), `${lifecycle}/${operation}`);
      for (const record of resources) {
        assert.equal(record.observation.schema, "logos/prepared-resource-observation/3");
        assert.deepEqual(record.observation.hostMemory, { limitPages: 4095, pageBytes: 65536, limitBytes: 4095 * 65536 });
        assert.equal(record.observation.preparedInput.status, "observed");
        assert.ok(record.observation.preparedInput.limitBytes > 0);
        assert.equal(record.observation.preparedInput.reason, null);
        assert.equal(record.observation.mode, "minimal");
        assert.equal(record.observation.guestIdentity.status, "observed");
        assert.match(record.observation.guestIdentity.sha256, /^[a-f0-9]{64}$/);
        assert.ok(record.observation.exports.length > 0);
        assert.ok(record.observation.exports.every((entry: { after: { status: string } }) => entry.after.status === "observed"));
      }
      assert.ok(new Set(resources.map(record => record.observation.searcher)).size >= 2);
      const identities = resources.map(record => `${record.observation.searcher}/${record.observation.hostCall}`);
      assert.equal(new Set(identities).size, identities.length);
      assert.ok(control.records().some(record => record.phase === "witness-close" && record.edge === "complete"));
      assert.equal(JSON.stringify(resources).includes(marker), false);
      assert.equal(control.failures().length, 0);
    } finally { request?.close(); if (result?.kind === "permitted") result.witness.close(); runtime.close(); }
  });
});

test("actual Searcher creation distinguishes absent and compiled-disabled resource modes", async () => {
  await remoteControl("actual resource modes", async control => {
    const config = { root: atom("resource-mode-root"), bundles: [], authenticate: () => true, memoryLimitPages: 4094,
      preparationBudget: { maxBundles: 1, maxClauses: 1000, maxPayloadBytes: 1024 * 1024 } };
    const absent = await createSpacesRuntime(config);
    absent.close();
    assert.equal(control.resources().length, 0);
    assert.equal(Object.getOwnPropertyDescriptor(globalThis, resourceModeHook), undefined);
    process.env.PREPARED_RESOURCE_OBSERVER_MODE = "compiled-disabled";
    const disabled = await createSpacesRuntime(config);
    disabled.close();
    const records = control.resources();
    assert.ok(records.length > 0);
    for (const record of records) {
      assert.equal(record.observation.mode, "compiled-disabled");
      assert.deepEqual(record.observation.hostMemory, { limitPages: 4094, pageBytes: 65536, limitBytes: 4094 * 65536 });
      assert.equal(record.observation.preparedInput.status, "observed");
      assert.ok(record.observation.preparedInput.limitBytes > 0);
      assert.equal(record.observation.preparedInput.reason, null);
      assert.ok(record.observation.exports.length > 0);
      for (const entry of record.observation.exports) for (const snapshot of [entry.before, entry.after]) {
        assert.equal(snapshot.status, "disabled");
        assert.equal(snapshot.aggregateValid, false); assert.equal(snapshot.associationValid, false);
        assert.equal(snapshot.words.length, 8960);
      }
    }
    assert.equal(control.failures().length, 0);
  });
});

test("actual runtime close keeps both cleanup calls and the original error when resource collection fails", async t => {
  await remoteControl("actual resource cleanup failure", async control => {
    process.env.PREPARED_RESOURCE_OBSERVER_MODE = "minimal";
    const runtime = await createSpacesRuntime({ root: atom("resource-cleanup-root"), bundles: [], authenticate: () => true,
      preparationBudget: { maxBundles: 1, maxClauses: 1000, maxPayloadBytes: 1024 * 1024 } });
    const primary = new Error("original lease-close failure"), calls: string[] = [];
    const leaseClose = PreparedViewLease.prototype.close, ownerClose = Session.prototype.close;
    // test-double: forwarding(real native cleanup runs first, then the first
    // close reports its own error; the unchanged outer finally must close owner)
    const leaseMock = t.mock.method(PreparedViewLease.prototype, "close", function (this: PreparedViewLease) {
      calls.push("lease"); leaseClose.call(this); throw primary;
    });
    const ownerMock = t.mock.method(Session.prototype, "close", function (this: Session) { calls.push("owner"); ownerClose.call(this); });
    try {
      process.env.PREPARED_OBSERVATION_CONFIGURATION_SHA256 = "invalid unit configuration";
      assert.throws(() => runtime.close(), error => error === primary);
      assert.deepEqual(calls, ["lease", "owner"]);
      assert.equal(control.failures().some(record => record.phase === "resource-sink"), true);
      assert.equal(process.exitCode, 1);
      assert.doesNotThrow(() => runtime.close());
      assert.deepEqual(calls, ["lease", "owner"]);
    } finally { leaseMock.mock.restore(); ownerMock.mock.restore(); runtime.close(); }
  });
});
