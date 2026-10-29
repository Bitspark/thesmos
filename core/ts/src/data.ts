import { Atom, ClauseId, programDigest, programFromValue } from "@bitspark/logos-contract";
import { decode } from "@bitspark/ontos-codec";
// The frozen law is embedded at build time (see scripts/compile-law.ts), so loading the library
// reads no files: the verifier and every entry run in Node, browsers and edge runtimes alike.
import {
  assertionTemplateBytes as templateBytes, commonLawBytes as bytes, protocol,
  spaceAsserterTemplateBytes as layerBytes,
} from "./law.generated.js";

export { protocol };
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
