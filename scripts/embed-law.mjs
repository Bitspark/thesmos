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

// The Go module (core/go) is fetched as source by `go get`, and the Rust crate (core/rs) as a git
// dependency or vendored copy, with no build step, so each carries a committed byte copy of the
// same artifacts. `--check-go` and `--check-rs` (run by `npm run law:check`) fail if a copy differs
// from law/; `--go` and `--rs` rewrite it. The law/ files stay the only source.
const copies = { go: {
  "core/go/law/common-law.ontos": "common-law.ontos",
  "core/go/law/assertion-template.ontos": "assertion-template.ontos",
  "core/go/law/space-asserter-template.ontos": "layers/space-asserter-template.ontos",
  "core/go/law/protocol.json": "protocol.json",
  "core/go/testdata/conformance.ontos": "conformance.ontos",
  "core/go/LICENSE": "../LICENSE",
  "core/go/NOTICE": "../NOTICE",
}, rs: {
  "core/rs/law/common-law.ontos": "common-law.ontos",
  "core/rs/law/assertion-template.ontos": "assertion-template.ontos",
  "core/rs/law/space-asserter-template.ontos": "layers/space-asserter-template.ontos",
  "core/rs/law/protocol.json": "protocol.json",
  "core/rs/tests/data/conformance.ontos": "conformance.ontos",
  "core/rs/tests/data/archon-document.ontos": "../core/go/testdata/archon-document.ontos",
  "core/rs/LICENSE": "../LICENSE",
  "core/rs/NOTICE": "../NOTICE",
} };
for (const [language, files] of Object.entries(copies)) {
  const write = process.argv.includes(`--${language}`);
  if (!write && !process.argv.includes(`--check-${language}`)) continue;
  const stale = [];
  for (const [target, source] of Object.entries(files)) {
    const url = new URL(`../${target}`, import.meta.url);
    if (write) {
      mkdirSync(new URL(".", url), { recursive: true });
      writeFileSync(url, law(source));
    } else {
      let current;
      try { current = readFileSync(url); } catch { current = undefined; }
      if (!current || !current.equals(law(source))) stale.push(target);
    }
  }
  if (stale.length) throw new Error(`core/${language} law copy differs from law/: ${stale.join(", ")}; run node scripts/embed-law.mjs --${language}`);
  console.log(write ? `Copied the frozen law into core/${language}.` : `The core/${language} law copy equals law/.`);
}
