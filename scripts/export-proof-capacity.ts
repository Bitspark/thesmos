// Exports test inputs through the actual client composition seam, without running search.
// Run remotely after the complete gate. This is an artifact format, not a new service API.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Clause, clauseValue } from "@bitspark/logos-contract";
import { encode } from "@bitspark/ontos-codec";
import { prove } from "../core/ts/src/client.js";
import { encodeProofRequest } from "../core/ts/src/remote.js";
import { lawDigest, layerDigest } from "../core/ts/src/index.js";
import { conditionalCapacityFixture } from "../core/ts/test/capacity-fixture.js";

const output = process.argv[2];
if (!output) throw new TypeError("Pass a new artifact directory");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.match(revision, /^[0-9a-f]{40}$/);
if (process.argv[3]) assert.equal(revision, process.argv[3], "export must bind the exact qualified source");
const directory = resolve(output);
mkdirSync(directory, { recursive: false });
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const files: { name: string; bytes: number; sha256: string; hops: number; rules: number; facts: number; bundles: number }[] = [];
for (const hops of [4, 24, 32, 64, 128]) {
  const request = conditionalCapacityFixture(hops);
  let captured = false;
  const capturedOnly = new Error("input captured without search");
  try {
    await prove({ ...request, search: async input => {
      assert.equal(captured, false);
      captured = true;
      assert.ok(input.goal);
      const artifact = {
        schema: 1, kind: "thesmos-conditional-capacity-input", sourceRevision: revision, hops,
        origin: { repository: "Bitspark/bitspark-accounts", revision: "90a3b8e385d8e791f4ce0693ac6a33a065acdf1b",
          fixture: "test/proof-stack.test.ts:fixture", change: "All synthetic assertion timestamps fixed to1793228400000; structural reproduction, not original recorded bytes" },
        law: hex(lawDigest.bytes()), layer: hex(layerDigest.bytes()),
        // Each value uses the existing frozen Logos clause codec. Facts and the goal
        // use a zero-body Clause only as a container for their existing head terms.
        rules: input.rules!.map(clause => hex(encode(clauseValue(clause)))),
        facts: input.facts!.map(fact => hex(encode(clauseValue(new Clause(fact.toGoal(), []))))),
        goal: hex(encode(clauseValue(new Clause(input.goal, [])))),
        proofRequest: hex(encodeProofRequest(request)),
        searchExecuted: false,
      };
      const bytes = Buffer.from(JSON.stringify(artifact) + "\n"), name = `conditional-${hops}.json`;
      writeFileSync(join(directory, name), bytes, { flag: "wx" });
      files.push({ name, bytes: bytes.byteLength, sha256: sha(bytes), hops,
        rules: artifact.rules.length, facts: artifact.facts.length, bundles: request.bundles.length });
      throw capturedOnly;
    } });
    throw new Error("Capture unexpectedly returned a proof");
  } catch (error) {
    if (error !== capturedOnly) throw error;
  }
  assert.equal(captured, true);
}
writeFileSync(join(directory, "manifest.json"), JSON.stringify({ schema: 1,
  kind: "thesmos-proof-capacity-input-manifest", sourceRevision: revision, files, searchExecuted: false,
}, null, 2) + "\n", { flag: "wx" });
console.log(`Exported ${files.length} deterministic compiled inputs at ${revision}; no proof search or capacity claim.`);
