import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
assert(pack.files.some(file => file.path === "dist/core/ts/src/remote.d.ts"));
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
writeFileSync(join(directory, "check.mjs"), `
import { strict as assert } from 'node:assert';
import { atom, attributedClause, createSpacesVerifier, inspectAttributedClause, lawDigest, path, fact } from '@bitspark/thesmos';
import { prove } from '@bitspark/thesmos/client';
import { authenticateArchon } from '@bitspark/thesmos/archon';
import { issuerSubjectPrincipal, decodeIssuerSubjectPrincipal } from '@bitspark/thesmos/identity';
assert.equal(lawDigest.bytes().length, 32);
const account = issuerSubjectPrincipal('https://accounts.example', 'alice');
assert.deepEqual(decodeIssuerSubjectPrincipal(account), {issuer: 'https://accounts.example', subject: 'alice'});
assert.equal(inspectAttributedClause(attributedClause(account, path(), fact('example'))).author.equals(account), true);
const root = atom('synthetic-test-root');
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
const filesystem = ["fs", "node:fs", "fs/promises", "node:fs/promises", "module", "node:module",
  "law data self-import", "process.getBuiltinModule", "import.meta.url"];
const entries = {
  // The receiver and its helpers embed the frozen law: no search, signing, network or files.
  ".": { forbidden: ["@bitspark/logos-kernel", "@bitspark/archon", ...network, ...filesystem], noEntries: true },
  "./identity": { forbidden: ["@bitspark/logos-kernel", "@bitspark/archon", ...network, ...filesystem], noEntries: true },
  "./archon": { forbidden: ["@bitspark/logos-kernel", ...network] },
  "./client": { forbidden: [...network] },
  // The remote adapter reaches its provider through the caller's fetch: no kernel, signing or files.
  "./remote": { forbidden: ["@bitspark/logos-kernel", "@bitspark/archon", ...network, ...filesystem], noEntries: true },
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
// Both an entry's code and its declarations identify it, so either graph can detect reaching another entry.
const entryFiles = new Map(Object.keys(entries).flatMap(key => [
  [resolve(exportFile(key)), key], [resolve(join(installed, manifest.exports[key].types)), key]]));
// The same package rules hold for each entry's declarations: a consumer type-checks what it installs.
const graphs = [...Object.entries(entries).map(([key, rule]) => [key, rule, resolve(exportFile(key))]),
  ...Object.entries(entries).map(([key, rule]) => [`${key} (types)`,
    rule,
    resolve(join(installed, manifest.exports[key].types))])];
for (const [key, rule, start] of graphs) {
  const seen = new Set(), bare = new Set(), reached = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file !== start && entryFiles.has(file)) reached.add(entryFiles.get(file));
    const source = readFileSync(file, "utf8");
    const references = [...source.matchAll(/\/\/\/\s*<reference\s+types=["']([^"']+)["']/g)].map(match => match[1]);
    if (/\bgetBuiltinModule\s*\(/.test(source)) bare.add("process.getBuiltinModule");
    if (/\bimport\.meta\.url\b/.test(source)) bare.add("import.meta.url");
    for (const name of references) bare.add(name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/"));
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)) {
      if (specifier.startsWith(".")) {
        visit(resolve(dirname(file), file.endsWith(".d.ts") ? specifier.replace(/\.js$/, ".d.ts") : specifier));
      }
      else if (specifier === "@bitspark/thesmos" || specifier.startsWith("@bitspark/thesmos/")) {
        // A self-import resolves through the exports map; law data (./law/*) holds no code.
        const target = manifest.exports["." + specifier.slice("@bitspark/thesmos".length)];
        if (typeof target === "object") visit(resolve(installed, file.endsWith(".d.ts") ? target.types : target.default));
        else bare.add("law data self-import"); // e.g. @bitspark/thesmos/law/*: data read at runtime
      } else bare.add(specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/"));
    }
  };
  visit(start);
  const violations = [...rule.forbidden.filter(name => bare.has(name)),
    ...(rule.noEntries ? [...reached].map(entry => `entry ${entry}`) : [])];
  assert.deepEqual(violations, [], `Entry ${key} imports ${violations.join(", ")}`);
}
console.log(`Entry isolation holds for ${Object.keys(entries).join(", ")}, code and declarations.`);

// A remote-only consumer: no Logos kernel, WASM or Archon installed. It type-checks against the
// published declarations, calls the HTTP adapter and verifies the returned proof unchanged.
writeFileSync(join(directory, "fixture.mjs"), [
  "import { createHash } from 'node:crypto';",
  "import { writeFileSync } from 'node:fs';",
  "import { Atom } from '@bitspark/logos-contract';",
  "import { atom, attributedClause, authorization, encodeSpaceFacts, fact, path } from '@bitspark/thesmos';",
  "import { prove } from '@bitspark/thesmos/client';",
  "import { encodeProofResult } from '@bitspark/thesmos/remote';",
  "const root = atom('synthetic-test-root'), space = path('remote');",
  "const payload = encodeSpaceFacts({ supplier: root, space, assertedAt: atom('fixture'),",
  "  clauses: [attributedClause(root, space, authorization(atom('caller'), fact('operation'), space))] });",
  "const bundles = [{ payload, authentication: new Atom(createHash('sha256').update(payload).digest()) }];",
  "const proof = await prove({ root, query: { actor: atom('caller'), space, statement: fact('operation') }, bundles });",
  "writeFileSync(process.argv[2], encodeProofResult({ kind: 'proof', proof, observations: [] }));",
].join("\n"));
const resultFile = join(directory, "remote-result.bin");
execFileSync(process.execPath, [join(directory, "fixture.mjs"), resultFile], { encoding: "utf8", cwd: directory });
const remote = mkdtempSync(join(tmpdir(), "thesmos-remote-"));
// Only the runtime dependencies: the optional Logos kernel and Archon peers stay uninstalled.
const runtimeOnly = { name: "thesmos-remote-consumer", private: true, type: "module", dependencies: manifest.dependencies };
const runtimeLock = structuredClone(lock);
runtimeLock.name = runtimeOnly.name;
runtimeLock.packages[""] = { name: runtimeOnly.name, dependencies: manifest.dependencies };
for (const [key, entry] of Object.entries(runtimeLock.packages)) if (key && entry.dev) delete runtimeLock.packages[key];
writeFileSync(join(remote, "package.json"), JSON.stringify(runtimeOnly));
writeFileSync(join(remote, "package-lock.json"), JSON.stringify(runtimeLock));
npm(["ci", "--offline", "--omit=dev", "--omit=peer", "--ignore-scripts", "--allow-remote=all", "--no-audit"], remote);
npm(["install", "--offline", "--omit=dev", "--omit=peer", "--ignore-scripts", "--allow-remote=all", "--no-audit", join(directory, pack.filename)], remote);
for (const absent of ["@bitspark/logos-kernel", "@bitspark/archon"]) {
  assert(!existsSync(join(remote, "node_modules", ...absent.split("/"))), `${absent} must not be installed for the remote-only consumer`);
}
copyFileSync(resultFile, join(remote, "remote-result.bin"));
writeFileSync(join(remote, "remote-check.ts"), [
  "import { createHash } from 'node:crypto';",
  "import { readFileSync } from 'node:fs';",
  "import { createServer } from 'node:http';",
  "import type { AddressInfo } from 'node:net';",
  "import { Atom } from '@bitspark/logos-contract';",
  "import { atom, createSpacesVerifier, fact, path, type AuthenticateSpaceFacts } from '@bitspark/thesmos';",
  "import { createHttpProofProvider, proofMediaType, type ProofRequest } from '@bitspark/thesmos/remote';",
  "const result = readFileSync('remote-result.bin');",
  "const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': proofMediaType }).end(result); });",
  "await new Promise<void>(done => server.listen(0, '127.0.0.1', done));",
  "const endpoint = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/proofs';",
  "const root = atom('synthetic-test-root');",
  "const request: ProofRequest = { root, query: { actor: atom('caller'), space: path('remote'), statement: fact('operation') } };",
  "const produced = await createHttpProofProvider({ endpoint }).produce(request);",
  "server.close();",
  "const digest: AuthenticateSpaceFacts = ({ payload, authentication }) => authentication instanceof Atom &&",
  "  Buffer.from(createHash('sha256').update(payload).digest()).equals(Buffer.from(authentication.bytes()));",
  "const decision = createSpacesVerifier({ root, authenticate: digest }).verify({ query: request.query, proof: produced.proof });",
  "if (!decision.permitted) throw new Error('remote proof did not verify: ' + decision.code);",
  "console.log('Remote-only consumer (no Logos kernel, WASM or Archon) type-checks, calls the HTTP adapter and verifies the proof.');",
].join("\n"));
const typescript = resolve("node_modules", "typescript", "bin", "tsc");
execFileSync(process.execPath, [typescript, "--strict", "--target", "es2023", "--module", "nodenext",
  "--moduleResolution", "nodenext", "--typeRoots", resolve("node_modules", "@types"), "--types", "node",
  "--outDir", join(remote, "out"), join(remote, "remote-check.ts")], { encoding: "utf8", cwd: remote });
process.stdout.write(execFileSync(process.execPath, [join(remote, "out", "remote-check.js")], { encoding: "utf8", cwd: remote }));
// Retain the exact archive that passed the independent consumer check.
mkdirSync(".build-artifacts", { recursive: true });
copyFileSync(join(directory, pack.filename), join(".build-artifacts", pack.filename));
console.log(`Package inspected: ${pack.filename} (${pack.files.length} files). Temporary consumer: ${directory}`);
