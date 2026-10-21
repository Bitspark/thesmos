import assert from "node:assert/strict";
import test from "node:test";
import {
  Bindings, DatasetSnapshot, Multiplicity, Program,
  type PreparedInputs, type PreparedRuntime, type PreparedViewFactory,
} from "@bitspark/logos-kernel";
import { diagnosticFactory, runtimePhase } from "../src/runtime-diagnostic.js";

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
