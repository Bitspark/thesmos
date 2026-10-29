import { strict as assert } from "node:assert";
import { test } from "node:test";
import { embedQuery, RunLimits, type EmbedRequest } from "@bitspark/logos-kernel";
import { authenticateArchon } from "../src/archon.js";
import { answerProofRequest, createLocalProofProvider, prove } from "../src/client.js";
import { atom, createSpacesVerifier, decodeProof, path } from "../src/index.js";
import { bob, documentBundles, root, space, statement } from "../../../examples/document-service.js";

const query = { actor: bob, space, statement };

test("a host-selected Logos implementation retains proof conversion, exact evidence and independent checking", async () => {
  const bundles = documentBundles(), controller = new AbortController();
  const limits = { ...RunLimits.default(), memoryBytes: 805_306_368, wallClockMs: 15_000 };
  let calls = 0;
  const proof = await prove({ root, query, bundles, limits, memoryLimitPages: 16_384,
    search: async (request, signal) => {
      calls++;
      assert.equal(signal, controller.signal);
      assert.equal(request.limits, limits);
      assert.equal(request.memoryLimitPages, 16_384);
      assert.ok(request.rules!.length > bundles.length);
      assert.equal(request.facts!.length, 1);
      assert.ok(request.goal);
      return embedQuery(request, signal);
    },
  }, controller.signal);
  assert.equal(calls, 1);
  const decoded = decodeProof(proof);
  for (const carried of decoded.bundles) assert.ok(bundles.some(input =>
    Buffer.from(input.payload).equals(carried.payload) && input.authentication.equals(carried.authentication)));
  const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
  assert.equal(verifier.verify({ query, proof }).permitted, true);
  assert.equal(verifier.verify({ query: { ...query, actor: atom("different_actor") }, proof }).permitted, false);
  assert.equal(verifier.verify({ query: { ...query, space: path("sibling") }, proof }).permitted, false);
});

test("host search receives reduced budgets and cancellation; a wire request cannot replace it", async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = { root, query, bundles: documentBundles(),
    budget: { deadlineMs: 10_000, memoryBytes: 4096, searchNodes: 2 },
    search: () => { throw new Error("request-selected code must not run"); },
  };
  const result = await answerProofRequest(request, {
    authenticate: authenticateArchon, elapsedMs: 50.5, signal: controller.signal,
    ceilings: { deadlineMs: 5000, memoryBytes: 8192, searchNodes: 1 },
    search: async (input, signal) => {
      calls++;
      assert.equal(signal, controller.signal);
      assert.equal(input.limits!.wallClockMs, 4949);
      assert.equal(input.limits!.memoryBytes, 4096);
      assert.equal(input.limits!.searchNodes, 1);
      return embedQuery(input, signal);
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { kind: "failure", code: "not_completed" });
});

test("producer transport failures remain failures without invoking the default search", async () => {
  const fault = new Error("producer transport failed");
  let calls = 0;
  const search = async (_request: EmbedRequest) => { calls++; throw fault; };
  // The default implementation can prove this query. Falling back would incorrectly hide the fault.
  const request = { root, query: { actor: root, space, statement }, bundles: [] };
  await assert.rejects(prove({ ...request, search }), error => error === fault);
  await assert.rejects(answerProofRequest(request, { authenticate: null, search }), error => error === fault);
  await assert.rejects(createLocalProofProvider({ authenticate: null, search }).produce(request), error => error === fault);
  assert.equal(calls, 3);
});

test("a deadline already spent prevents dispatch to the host producer", async () => {
  let calls = 0;
  const result = await answerProofRequest({ root, query, bundles: documentBundles(), budget: { deadlineMs: 10 } }, {
    authenticate: authenticateArchon, elapsedMs: 10,
    search: async (request, signal) => { calls++; return embedQuery(request, signal); },
  });
  assert.equal(result.kind, "failure");
  if (result.kind === "failure") assert.equal(result.code, "not_completed");
  assert.equal(calls, 0);
});
