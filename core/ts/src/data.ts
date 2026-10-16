import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Atom, ClauseId, programDigest, programFromValue } from "@bitspark/logos-contract";
import { decode } from "@bitspark/ontos-codec";
import protocol from "@bitspark/thesmos/law/protocol.json" with { type: "json" };

export { protocol };
const require = createRequire(import.meta.url);
const bytes = readFileSync(require.resolve("@bitspark/thesmos/law/common-law.ontos"));
const templateBytes = readFileSync(require.resolve("@bitspark/thesmos/law/assertion-template.ontos"));
const layerBytes = readFileSync(require.resolve("@bitspark/thesmos/law/layers/space-asserter-template.ontos"));
export function loadLaw() { return programFromValue(decode(bytes)); }
export function assertionTemplate() {
  return programFromValue(decode(templateBytes)).clause(ClauseId.of("assertion-template"))!;
}
export function spaceAsserterTemplate() {
  return programFromValue(decode(layerBytes)).clause(ClauseId.of("supplied-assertion-template"))!;
}
/** Bind the executable law and assertion construction to one native program digest. */
export const lawDigest = new Atom(programDigest([
  ...loadLaw().entries().map(([, clause]) => clause), assertionTemplate(),
]));
/** The layer has its own identity; the frozen core's identity is unchanged. */
export const layerDigest = new Atom(programDigest([spaceAsserterTemplate()]));
