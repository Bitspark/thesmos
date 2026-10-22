import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  Bindings, DatasetSnapshot, Multiplicity, PreparedQuery, PreparedViewLease, Program,
  type PreparedInputs, type PreparedRuntime, type PreparedViewFactory,
} from "@bitspark/logos-kernel";
import { diagnosticFactory, diagnosticRequest, runtimePhase } from "../src/runtime-diagnostic.js";
import { atom, path } from "../src/index.js";
import { createSpacesRuntime } from "../src/runtime.js";

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
type RemoteControl = {
  records(): ReturnType<typeof JSON.parse>[];
  failures(): ReturnType<typeof JSON.parse>[];
  receipt: string;
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
  const descriptors = [nativeHook, operationHook, factoryHook].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
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
    console.log = () => {};
    console.error = () => {};
    await operation({ records: () => readLines("runtime-phases.ndjson"), failures: () => readLines("runtime-diagnostic-failures.ndjson"), receipt });
  } finally {
    try {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    } finally {
      console.log = previousLog; console.error = previousError;
      for (const [name, value] of [["PREPARED_MEASUREMENT_MODE", previousMode], ["RUNNER_TEMP", previousTemporary],
        ["PREPARED_BUILD_RECEIPT_SHA256", previousReceipt]] as const) {
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
      assert.equal(record.edge, "observed"); assert.equal(record.activation, 700);
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
