import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// An actual packed consumer catches missing law assets and broken package exports.
const npm = (args, cwd) => process.platform === "win32"
  ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "npm", ...args], { cwd, encoding: "utf8" })
  : execFileSync("npm", args, { cwd, encoding: "utf8" });
const directory = mkdtempSync(join(tmpdir(), "thesmos-pack-"));
const [pack] = Object.values(JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory], process.cwd())));
assert(pack.files.some(file => file.path === "law/common-law.ontos"));
assert(pack.files.some(file => file.path === "dist/core/ts/src/client.d.ts"));
assert(pack.files.some(file => file.path === "dist/core/ts/src/identity.d.ts"));
assert(pack.files.some(file => file.path === "dist/core/ts/src/runtime.d.ts"));
assert(pack.files.every(file => !/node_modules|test\/|examples\/|\.git\//.test(file.path)));
// The lockfile's dependency URLs preserve the selected private Logos artifacts.
// Use an independent package installation, not workspace imports.
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const consumer = { ...manifest, name: "thesmos-packed-consumer", private: true, scripts: {}, exports: undefined };
lock.name = consumer.name;
lock.packages[""].name = consumer.name;
writeFileSync(join(directory, "package.json"), JSON.stringify(consumer));
writeFileSync(join(directory, "package-lock.json"), JSON.stringify(lock));
npm(["ci", "--offline", "--ignore-scripts", "--allow-remote=all", "--no-audit"], directory);
npm(["install", "--offline", "--ignore-scripts", "--allow-remote=all", "--no-audit", join(directory, pack.filename)], directory);
// A downstream source-candidate gate supplies the two archives built from its
// recorded Logos revision. This remains an independent packed installation.
const candidate = [process.env.THESMOS_CANDIDATE_LOGOS_CONTRACT, process.env.THESMOS_CANDIDATE_LOGOS_KERNEL];
if (candidate.some(Boolean)) {
  assert(candidate.every(Boolean) && /^[a-f0-9]{40}$/.test(process.env.LOGOS_REVISION ?? ""), "Candidate packages require an exact paired source pin");
  npm(["install", "--offline", "--ignore-scripts", "--allow-remote=all", "--no-audit", "--no-save", ...candidate], directory);
}
writeFileSync(join(directory, "check.mjs"), `
import { strict as assert } from 'node:assert';
import { atom, attributedClause, createSpacesVerifier, inspectAttributedClause, lawDigest, path, fact } from '@bitspark/thesmos';
import { prove } from '@bitspark/thesmos/client';
import { authenticateArchon } from '@bitspark/thesmos/archon';
import { issuerSubjectPrincipal, decodeIssuerSubjectPrincipal } from '@bitspark/thesmos/identity';
import { prepareSpacesProgram } from '@bitspark/thesmos/runtime';
assert.equal(lawDigest.bytes().length, 32);
const account = issuerSubjectPrincipal('https://accounts.example', 'alice');
assert.deepEqual(decodeIssuerSubjectPrincipal(account), {issuer: 'https://accounts.example', subject: 'alice'});
assert.equal(inspectAttributedClause(attributedClause(account, path(), fact('example'))).author.equals(account), true);
const root = atom('synthetic-test-root');
assert(prepareSpacesProgram({bundles: [], authenticate: authenticateArchon,
  budget: {maxBundles: 0, maxClauses: 0, maxPayloadBytes: 0}}).nativeProgram().size() > 0);
const query = {actor: root, space: path('child'), statement: fact('operation')};
const proof = await prove({root, query, bundles: []});
assert.equal(createSpacesVerifier({root, authenticate: authenticateArchon}).verify({query, proof}).permitted, true);
console.log('Packed client constructs a proof; packed verifier and law accept it in an independent consumer.');
`);
process.stdout.write(execFileSync(process.execPath, [join(directory, "check.mjs")], { encoding: "utf8", cwd: directory }));

// Each installed entry point's static import graph keeps search, signing and network code out of
// the entries that must not carry them: a receiver importing the root installs no search engine.
const installed = join(directory, "node_modules", "@bitspark", "thesmos");
const network = ["http", "https", "http2", "net", "tls", "dns", "dgram"].flatMap(name => [name, "node:" + name]);
const entries = {
  ".": { forbidden: ["@bitspark/logos-kernel", "@bitspark/archon", ...network], noEntries: true },
  "./identity": { forbidden: ["@bitspark/logos-kernel", "@bitspark/archon", ...network], noEntries: true },
  "./archon": { forbidden: ["@bitspark/logos-kernel", ...network] },
  "./client": { forbidden: [...network] },
  "./runtime": { forbidden: ["@bitspark/archon", ...network] },
};
// Wildcard exports may only expose the law's data files; every code entry needs a rule.
for (const [key, target] of Object.entries(manifest.exports)) {
  if (key.includes("*")) assert.equal(target, "./law/*", `Wildcard export ${key} must expose only law data`);
  else {
    assert.equal(typeof target?.default, "string", `Entry ${key} must declare a default target`);
    assert(entries[key], `Entry ${key} has no isolation rule in scripts/check-package.mjs`);
  }
}
const exportFile = key => join(installed, manifest.exports[key].default);
const entryFiles = new Map(Object.keys(entries).map(key => [resolve(exportFile(key)), key]));
for (const [key, rule] of Object.entries(entries)) {
  const start = resolve(exportFile(key));
  const seen = new Set(), bare = new Set(), reached = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file !== start && entryFiles.has(file)) reached.add(entryFiles.get(file));
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)) {
      if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
      else if (specifier === "@bitspark/thesmos" || specifier.startsWith("@bitspark/thesmos/")) {
        // A self-import resolves through the exports map; law data (./law/*) holds no code.
        const target = manifest.exports["." + specifier.slice("@bitspark/thesmos".length)];
        if (target) visit(resolve(installed, target.default));
      } else bare.add(specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/"));
    }
  };
  visit(start);
  const violations = [...rule.forbidden.filter(name => bare.has(name)),
    ...(rule.noEntries ? [...reached].map(entry => `entry ${entry}`) : [])];
  assert.deepEqual(violations, [], `Entry ${key} imports ${violations.join(", ")}`);
}
console.log(`Entry isolation holds for ${Object.keys(entries).join(", ")}.`);
// Retain the exact archive that passed the independent consumer check.
mkdirSync(".build-artifacts", { recursive: true });
copyFileSync(join(directory, pack.filename), join(".build-artifacts", pack.filename));
const archiveSha256 = createHash("sha256").update(readFileSync(join(directory, pack.filename))).digest("hex");
writeFileSync(join(".build-artifacts", "SHA256SUMS"), `${archiveSha256}  ${pack.filename}\n`);
writeFileSync(join(".build-artifacts", "release-artifact.json"), JSON.stringify({
  source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  run: process.env.GITHUB_RUN_ID ?? null, node: process.version, packedConsumer: "passed",
  package: { name: manifest.name, version: manifest.version, filename: pack.filename,
    bytes: readFileSync(join(directory, pack.filename)).byteLength, sha256: archiveSha256, integrity: pack.integrity },
  dependencies: manifest.dependencies, peerDependencies: manifest.peerDependencies,
}, null, 2) + "\n");
console.log(`Package inspected: ${pack.filename} (${pack.files.length} files). Temporary consumer: ${directory}`);
