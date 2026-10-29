import { readFileSync, writeFileSync } from "node:fs";

// Build step: bind the frozen law into the library as a generated module, so loading thesmos
// reads no files at runtime. The law/ files stay the only source; this output is never committed.
const law = path => readFileSync(new URL(`../law/${path}`, import.meta.url));
const base64 = bytes => bytes.toString("base64").replace(/.{1,96}/g, part => `\n  "${part}" +`).slice(0, -2);
const protocol = JSON.parse(law("protocol.json").toString("utf8"));

writeFileSync(new URL("../core/ts/src/law.generated.ts", import.meta.url), [
  "// Generated at build time by scripts/embed-law.mjs from law/*.ontos and law/protocol.json.",
  "// Do not edit or commit; the law/ files are the source, pinned by conformance/frozen.json.",
  "",
  "const bytes = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));",
  "",
  `export const commonLawBytes = bytes(${base64(law("common-law.ontos"))});`,
  `export const assertionTemplateBytes = bytes(${base64(law("assertion-template.ontos"))});`,
  `export const spaceAsserterTemplateBytes = bytes(${base64(law("layers/space-asserter-template.ontos"))});`,
  "",
  `export const protocol = ${JSON.stringify(protocol, null, 2)};`,
  "",
].join("\n"));
console.log("Embedded the frozen law in core/ts/src/law.generated.ts.");
