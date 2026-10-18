import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// An actual packed consumer catches missing law assets and broken package exports.
const npm = (args, cwd) => process.platform === "win32"
  ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "npm", ...args], { cwd, encoding: "utf8" })
  : execFileSync("npm", args, { cwd, encoding: "utf8" });
const directory = mkdtempSync(join(tmpdir(), "thesmos-pack-"));
const [pack] = Object.values(JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory], process.cwd())));
assert(pack.files.some(file => file.path === "law/common-law.ontos"));
assert(pack.files.some(file => file.path === "dist/core/ts/src/client.d.ts"));
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
import { atom, createSpacesVerifier, lawDigest, path, fact } from '@bitspark/thesmos';
import { prove } from '@bitspark/thesmos/client';
import { authenticateArchon } from '@bitspark/thesmos/archon';
assert.equal(lawDigest.bytes().length, 32);
const root = atom('synthetic-test-root');
const query = {actor: root, space: path('child'), statement: fact('operation')};
const proof = await prove({root, query, bundles: []});
assert.equal(createSpacesVerifier({root, authenticate: authenticateArchon}).verify({query, proof}).permitted, true);
console.log('Packed client constructs a proof; packed verifier and law accept it in an independent consumer.');
`);
process.stdout.write(execFileSync(process.execPath, [join(directory, "check.mjs")], { encoding: "utf8", cwd: directory }));
// Retain the exact archive that passed the independent consumer check.
mkdirSync(".build-artifacts", { recursive: true });
copyFileSync(join(directory, pack.filename), join(".build-artifacts", pack.filename));
console.log(`Package inspected: ${pack.filename} (${pack.files.length} files). Temporary consumer: ${directory}`);
