import { strict as assert } from "node:assert";
import test from "node:test";
import { inspectReleasedLock, installerManifest, releasedManifest } from "./refresh-dependencies.mjs";
import { LOGOS_NAMES, ONTOS_NAMES } from "./package-dependencies.mjs";

const versions = { logos: "0.25.0", ontos: "0.15.0", package: "1.0.0-preview.3" };
const original = { name: "@bitspark/thesmos", version: "1.0.0-preview.2", license: "Apache-2.0", engines: { node: ">=24" },
  dependencies: { [LOGOS_NAMES[0]]: "0.24.0", [ONTOS_NAMES[1]]: "0.13.0", [ONTOS_NAMES[2]]: "0.13.0" },
  devDependencies: { [LOGOS_NAMES[1]]: "0.24.0", "@bitspark/archon": "0.15.0" },
  peerDependencies: { [LOGOS_NAMES[1]]: "0.24.0", "@bitspark/archon": "0.15.0" },
  peerDependenciesMeta: { [LOGOS_NAMES[1]]: { optional: true } } };
const packages = () => Object.fromEntries([...LOGOS_NAMES, ...ONTOS_NAMES].map(name => [name, {
  name, version: LOGOS_NAMES.includes(name) ? versions.logos : versions.ontos,
  integrity: "sha512-YWJjZA==", tarball: `https://example.invalid/${name}.tgz`,
  dependencies: LOGOS_NAMES.includes(name) ? { ...Object.fromEntries(ONTOS_NAMES.map(name => [name, versions.ontos])),
    ...(name.endsWith("kernel") ? { [LOGOS_NAMES[0]]: "^" + versions.logos } : {}) } : {},
}]));
const lock = (manifest, selected) => ({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: {
  "": structuredClone(manifest),
  ...Object.fromEntries(Object.entries(selected).map(([name, value]) => ["node_modules/" + name,
    { version: value.version, resolved: value.tarball, integrity: value.integrity }])),
  "node_modules/@bitspark/archon": { version: "0.15.0", integrity: "sha512-c2FtZQ==", resolved: "https://example.invalid/archon.tgz" },
} });
const fixture = () => {
  const selected = packages(), intended = releasedManifest(original, versions, selected);
  const before = lock(original, selected), staged = lock(installerManifest(intended, selected), selected), after = lock(intended, selected);
  return { selected, intended, before, staged, after };
};

test("released refresh selects one published cohort without changing unrelated declarations", () => {
  const initial = structuredClone(original), selected = packages(), intended = releasedManifest(original, versions, selected);
  assert.deepEqual(original, initial);
  assert.equal(intended.dependencies[LOGOS_NAMES[0]], "0.25.0");
  assert.equal(intended.peerDependencies[LOGOS_NAMES[1]], "0.25.0");
  assert.equal(intended.devDependencies["@bitspark/archon"], original.devDependencies["@bitspark/archon"]);
  assert.equal(intended.dependencies[ONTOS_NAMES[1]], "0.15.0");
  const temporary = installerManifest(intended, selected);
  for (const [field, name] of [["dependencies", LOGOS_NAMES[0]], ["devDependencies", LOGOS_NAMES[1]], ["peerDependencies", LOGOS_NAMES[1]]]) {
    assert.equal(temporary[field][name], selected[name].tarball);
    assert.equal(intended[field][name], "0.25.0");
  }
  assert.equal(temporary.dependencies[ONTOS_NAMES[1]], "0.15.0");
});

test("released refresh refuses old, split and candidate-only dependency declarations", () => {
  for (const change of [
    (source, versions, selected) => { selected[LOGOS_NAMES[0]].dependencies[ONTOS_NAMES[0]] = "0.13.0"; },
    (source, versions) => { delete versions.package; },
    source => { source.overrides = { [ONTOS_NAMES[0]]: "0.15.0" }; },
    (source, versions) => { versions.logos = "latest"; },
  ]) {
    const source = structuredClone(original), requested = { ...versions }, selected = packages();
    change(source, requested, selected); assert.throws(() => releasedManifest(source, requested, selected));
  }
});

test("offline semver reconciliation must retain all real npm-generated package resolutions", () => {
  const { before, staged, after, intended, selected } = fixture();
  assert.equal(Object.keys(inspectReleasedLock(before, staged, after, intended, selected)).length, 5);
  for (const field of ["version", "resolved", "integrity"]) {
    const altered = structuredClone(after); altered.packages["node_modules/" + ONTOS_NAMES[0]][field] = "changed";
    assert.throws(() => inspectReleasedLock(before, staged, altered, intended, selected));
  }
});

test("released lock refuses unrelated drift, nested implementations and stale root specs", () => {
  for (const change of [
    value => { value.after.packages["node_modules/@bitspark/archon"].version = "0.16.0"; value.staged.packages["node_modules/@bitspark/archon"].version = "0.16.0"; },
    value => { for (const lock of [value.after, value.staged]) lock.packages["node_modules/old/node_modules/" + ONTOS_NAMES[0]] = { ...lock.packages["node_modules/" + ONTOS_NAMES[0]] }; },
    value => { value.after.packages[""].dependencies[LOGOS_NAMES[0]] = value.selected[LOGOS_NAMES[0]].tarball; },
    value => { value.after.requires = false; },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => inspectReleasedLock(value.before, value.staged, value.after, value.intended, value.selected));
  }
});
