import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Build step: bind the frozen law into the library as a generated module, so loading thesmos
// reads no files at runtime. The law/ files stay the only source; this output is never committed.
const law = path => readFileSync(new URL(`../law/${path}`, import.meta.url));
const base64 = bytes => bytes.toString("base64").replace(/.{1,96}/g, part => `\n  "${part}" +`).slice(0, -2);
const protocol = JSON.parse(law("protocol.json").toString("utf8"));

writeFileSync(new URL("../core/ts/src/law.generated.ts", import.meta.url), [
  "// Generated at build time by scripts/embed-law.mjs from law/*.ontos and law/protocol.json.",
  "// Do not edit or commit; the law/ files are the source, pinned by conformance/frozen.json.",
  "",
  "const bytes = (text: string): Uint8Array => Uint8Array.from(atob(text), char => char.charCodeAt(0));",
  "",
  `export const commonLawBytes = bytes(${base64(law("common-law.ontos"))});`,
  `export const assertionTemplateBytes = bytes(${base64(law("assertion-template.ontos"))});`,
  `export const spaceAsserterTemplateBytes = bytes(${base64(law("layers/space-asserter-template.ontos"))});`,
  "",
  `export const protocol = ${JSON.stringify(protocol, null, 2)};`,
  "",
].join("\n"));
console.log("Embedded the frozen law in core/ts/src/law.generated.ts.");

// The Go module (core/go) is fetched as source by `go get`, with no build step, so it carries a
// committed byte copy of the same artifacts. `--check-go` (run by `npm run law:check`) fails if
// that copy differs from law/; `--go` rewrites it. The law/ files stay the only source.
const goCopies = {
  "core/go/law/common-law.ontos": "common-law.ontos",
  "core/go/law/assertion-template.ontos": "assertion-template.ontos",
  "core/go/law/space-asserter-template.ontos": "layers/space-asserter-template.ontos",
  "core/go/law/protocol.json": "protocol.json",
  "core/go/testdata/conformance.ontos": "conformance.ontos",
};
if (process.argv.includes("--go") || process.argv.includes("--check-go")) {
  const stale = [];
  for (const [target, source] of Object.entries(goCopies)) {
    const url = new URL(`../${target}`, import.meta.url);
    if (process.argv.includes("--go")) {
      mkdirSync(new URL(".", url), { recursive: true });
      writeFileSync(url, law(source));
    } else {
      let current;
      try { current = readFileSync(url); } catch { current = undefined; }
      if (!current || !current.equals(law(source))) stale.push(target);
    }
  }
  if (stale.length) throw new Error(`Go law copy differs from law/: ${stale.join(", ")}; run node scripts/embed-law.mjs --go`);
  console.log(process.argv.includes("--go") ? "Copied the frozen law into core/go." : "The Go law copy equals law/.");
}
