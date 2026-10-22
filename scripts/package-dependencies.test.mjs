import { strict as assert } from "node:assert";
import test from "node:test";
import { candidateCohort, candidateConsumer, inspectCandidateLock, LOGOS_NAMES, ONTOS_NAMES, publishedMetadata } from "./package-dependencies.mjs";

const archives = () => Object.fromEntries(LOGOS_NAMES.map(name => [name, {
  manifest: { name, version: "0.25.0", dependencies: { ...Object.fromEntries(ONTOS_NAMES.map(name => [name, "0.15.0"])),
    ...(name.endsWith("kernel") ? { [LOGOS_NAMES[0]]: "^0.25.0" } : {}) } },
  sha256: "a".repeat(64), integrity: "sha512-YWJjZA==", bytes: 4,
}]));
const metadata = name => ({ name, version: "0.15.0", dist: { integrity: "sha512-YWJjZA==",
  tarball: `https://registry.npmjs.org/${name}/-/${name.slice(name.indexOf("/") + 1)}-0.15.0.tgz` } });
const published = () => Object.fromEntries(ONTOS_NAMES.map(name => [name, publishedMetadata(metadata(name), name, "0.15.0")]));
const lock = () => ({ packages: {
  ...Object.fromEntries(ONTOS_NAMES.map(name => ["node_modules/" + name, { version: "0.15.0", resolved: metadata(name).dist.tarball, integrity: metadata(name).dist.integrity }])),
  ...Object.fromEntries(LOGOS_NAMES.map(name => ["node_modules/" + name, { version: "0.25.0", resolved: `file:/candidate/${name.slice(name.indexOf("/") + 1)}.tgz`, integrity: "sha512-YWJjZA==" }])),
} });

test("candidate dependency plan preserves published declarations and explicitly records all overrides", () => {
  const manifest = { dependencies: { [LOGOS_NAMES[0]]: "0.24.0", [ONTOS_NAMES[1]]: "0.13.0", [ONTOS_NAMES[2]]: "0.13.0" },
    devDependencies: { [LOGOS_NAMES[1]]: "0.24.0" }, peerDependencies: { [LOGOS_NAMES[1]]: "0.24.0" } };
  const original = structuredClone(manifest);
  const result = candidateConsumer(manifest, archives(), Object.fromEntries(LOGOS_NAMES.map(name => [name, `/candidate/${name.slice(name.indexOf("/") + 1)}.tgz`])));
  assert.deepEqual(manifest, original);
  assert.deepEqual(result.cohort, { logosVersion: "0.25.0", ontosVersion: "0.15.0" });
  assert.deepEqual(Object.keys(result.consumer.overrides).sort(), [...LOGOS_NAMES, ...ONTOS_NAMES].sort());
  for (const name of [...LOGOS_NAMES, ...ONTOS_NAMES]) assert.equal(result.consumer.overrides[name], "$" + name);
  assert.equal(result.consumer.peerDependencies[LOGOS_NAMES[1]], "0.25.0");
  assert(result.consumer.devDependencies[LOGOS_NAMES[1]].startsWith("file:"));
  for (const name of ONTOS_NAMES) assert.equal(result.consumer.dependencies[name], "0.15.0");
});

test("candidate archives refuse split, missing, unknown and unreviewed dependency cohorts", () => {
  for (const mutate of [
    pair => { pair[LOGOS_NAMES[0]].manifest.dependencies[ONTOS_NAMES[0]] = "0.13.0"; },
    pair => { delete pair[LOGOS_NAMES[1]].manifest.dependencies[ONTOS_NAMES[2]]; },
    pair => { pair[LOGOS_NAMES[0]].manifest.dependencies["@bitspark/ontos-other"] = "0.15.0"; },
    pair => { for (const archive of Object.values(pair)) for (const name of ONTOS_NAMES) archive.manifest.dependencies[name] = "0.16.0"; },
    pair => { pair[LOGOS_NAMES[1]].manifest.version = "0.24.0"; },
    pair => { pair[LOGOS_NAMES[1]].manifest.dependencies[LOGOS_NAMES[0]] = "*"; },
  ]) { const pair = archives(); mutate(pair); assert.throws(() => candidateCohort(pair)); }
});

test("public package metadata binds exact registry, name, version and immutable artifact", () => {
  assert.equal(publishedMetadata(metadata(ONTOS_NAMES[0]), ONTOS_NAMES[0], "0.15.0").version, "0.15.0");
  for (const mutate of [
    value => { value.name = ONTOS_NAMES[1]; }, value => { value.version = "0.13.0"; },
    value => { value.dist.tarball = value.dist.tarball.replace("registry.npmjs.org", "npm.pkg.github.com"); },
    value => { value.dist.tarball = value.dist.tarball.replace("https://", "https://secret@"); },
    value => { value.dist.tarball += "?credential=bad"; }, value => { value.dist.integrity = ""; },
  ]) { const value = metadata(ONTOS_NAMES[0]); mutate(value); assert.throws(() => publishedMetadata(value, ONTOS_NAMES[0], "0.15.0")); }
});

test("installed candidate lock refuses missing, stale and nested package implementations", () => {
  assert.equal(Object.keys(inspectCandidateLock(lock(), archives(), published())).length, 5);
  for (const mutate of [
    value => { delete value.packages["node_modules/" + ONTOS_NAMES[0]]; },
    value => { value.packages["node_modules/" + ONTOS_NAMES[0]].version = "0.13.0"; },
    value => { value.packages["node_modules/example/node_modules/" + ONTOS_NAMES[0]] = { ...value.packages["node_modules/" + ONTOS_NAMES[0]] }; },
    value => { value.packages["node_modules/example/node_modules/" + LOGOS_NAMES[0]] = { ...value.packages["node_modules/" + LOGOS_NAMES[0]] }; },
    value => { value.packages["node_modules/" + LOGOS_NAMES[0]].link = true; },
    value => { value.packages["node_modules/" + LOGOS_NAMES[0]].integrity = "sha512-d3Jvbmc="; },
  ]) { const value = lock(); mutate(value); assert.throws(() => inspectCandidateLock(value, archives(), published())); }
});
