import assert from "node:assert/strict";
import test from "node:test";
import { runtimePhase } from "../src/runtime-diagnostic.js";

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
