import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";

const pins = JSON.parse(readFileSync(new URL("../conformance/frozen.json", import.meta.url), "utf8"));
for (const [file, digest] of Object.entries(pins.sha256)) {
  const bytes = readFileSync(new URL("../" + file, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, `${file}: frozen artifact changed`);
}
console.log(`Frozen revision ${pins.coreRevision}: ${Object.keys(pins.sha256).length} artifacts unchanged.`);
