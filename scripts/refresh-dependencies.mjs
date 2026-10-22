// Prepare a source patch from published artifacts. This never publishes or
// qualifies the resulting source; its complete committed-source check is next.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileIdentity, LOGOS_NAMES, ONTOS_NAMES, LOGOS_REGISTRY, PUBLIC_REGISTRY, publishedMetadata } from "./package-dependencies.mjs";

const exact = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const parse = file => JSON.parse(readFileSync(file, "utf8"));
const jsonBytes = value => JSON.stringify(value, null, 2) + "\n";

export function releasedManifest(original, versions, packages) {
  assert.deepEqual(Object.keys(versions).sort(), ["logos", "ontos", "package"], "The released cohort needs all exact version inputs");
  for (const value of Object.values(versions)) assert(exact.test(value ?? ""), "Exact published dependency and package versions are required");
  assert.equal(versions.ontos, "0.15.0", "This dependency transition requires the reviewed Ontos 0.15.0 release");
  assert(!original.overrides, "Released consumption cannot retain candidate dependency overrides");
  for (const name of LOGOS_NAMES) {
    assert.equal(packages[name]?.version, versions.logos);
    const dependencies = packages[name].dependencies;
    assert.deepEqual(Object.keys(dependencies).filter(name => name.startsWith("@bitspark/ontos-")).sort(), [...ONTOS_NAMES].sort());
    for (const dependency of ONTOS_NAMES) assert.equal(dependencies[dependency], versions.ontos, "Released Logos splits or predates the selected Ontos cohort");
  }
  assert([versions.logos, "^" + versions.logos].includes(packages[LOGOS_NAMES[1]].dependencies[LOGOS_NAMES[0]]),
    "Released kernel does not consume the paired contract version");
  const result = structuredClone(original);
  result.version = versions.package;
  result.dependencies[LOGOS_NAMES[0]] = versions.logos;
  result.devDependencies[LOGOS_NAMES[1]] = versions.logos;
  result.peerDependencies[LOGOS_NAMES[1]] = versions.logos;
  for (const name of ONTOS_NAMES.filter(name => name !== "@bitspark/ontos-core")) result.dependencies[name] = versions.ontos;
  return result;
}

export function installerManifest(intended, packages) {
  const result = structuredClone(intended);
  result.dependencies[LOGOS_NAMES[0]] = packages[LOGOS_NAMES[0]].tarball;
  result.devDependencies[LOGOS_NAMES[1]] = packages[LOGOS_NAMES[1]].tarball;
  result.peerDependencies[LOGOS_NAMES[1]] = packages[LOGOS_NAMES[1]].tarball;
  return result;
}

export function inspectReleasedLock(before, staged, after, intended, packages) {
  assert.equal(after.lockfileVersion, 3);
  const withoutRoot = value => Object.fromEntries(Object.entries(value.packages).filter(([name]) => name));
  assert.deepEqual(withoutRoot(after), withoutRoot(staged), "Offline semver reconciliation changed a resolved package");
  const cohort = [...LOGOS_NAMES, ...ONTOS_NAMES];
  const keys = cohort.map(name => "node_modules/" + name).sort();
  assert.deepEqual(Object.keys(after.packages).filter(name => /(?:^|\/)node_modules\/@bitspark\/(?:logos|ontos)-[^/]+$/.test(name)).sort(), keys,
    "The released lock must contain only one complete root Logos/Ontos cohort");
  const selected = {};
  for (const name of cohort) {
    const row = after.packages["node_modules/" + name], metadata = packages[name];
    assert.equal(row.version, metadata.version); assert.equal(row.resolved, metadata.tarball);
    assert.equal(row.integrity, metadata.integrity); assert(!row.link);
    selected[name] = { version: row.version, resolved: row.resolved, integrity: row.integrity };
  }
  const unrelated = value => Object.fromEntries(Object.entries(value.packages).filter(([name]) => name && !keys.includes(name)));
  assert.deepEqual(unrelated(after), unrelated(before), "An unrelated dependency changed; source review is required");
  const root = after.packages[""];
  for (const key of ["name", "version", "license", "dependencies", "devDependencies", "peerDependencies", "peerDependenciesMeta", "engines"])
    assert.deepEqual(root[key], intended[key], `Generated lock root differs from intended ${key}`);
  const omit = ({ packages: ignored, name, version, ...rest }) => rest;
  assert.deepEqual(omit(after), omit(before), "Unrelated lock metadata changed");
  assert.equal(after.name, intended.name); assert.equal(after.version, intended.version);
  return selected;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      process.env.THESMOS_REFRESH_OPERATION !== "refresh-dependencies" || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") || !process.env.RUNNER_TEMP)
    throw new Error("Dependency preparation requires the maintained remote refresh workflow");
  const output = join(process.env.RUNNER_TEMP, "dependency-refresh");
  mkdirSync(output, { recursive: true });
  const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
  const npm = args => execFileSync("npm", args, { encoding: "utf8" }).trim();
  const receipt = { format: "thesmos/released-dependencies/1", status: "incomplete", phase: "source-validation", run: process.env.GITHUB_RUN_ID,
    versions: { logos: process.env.LOGOS_VERSION, ontos: process.env.ONTOS_VERSION, package: process.env.PACKAGE_VERSION } };
  let intendedBytes;
  try {
    receipt.inputHead = git(["rev-parse", "HEAD"]);
    assert.equal(receipt.inputHead, process.env.GITHUB_SHA, "Refresh source differs from its workflow event");
    assert.equal(git(["status", "--porcelain"]), "", "Refresh requires a clean exact source checkout");
    assert.equal(process.version, "v24.22.0", "Unexpected dependency writer Node version");
    receipt.node = process.version; receipt.npm = npm(["--version"]);
    assert.equal(receipt.npm, "11.19.1", "Unexpected dependency writer npm version");
    receipt.helperSha256 = fileIdentity(fileURLToPath(import.meta.url)).sha256;
    receipt.inputFiles = Object.fromEntries(["package.json", "package-lock.json"].map(file => [file, fileIdentity(file).sha256]));
    for (const file of Object.keys(receipt.inputFiles)) assert.equal(readFileSync(file, "utf8"), execFileSync("git", ["show", "HEAD:" + file], { encoding: "utf8" }));
    const original = parse("package.json"), before = parse("package-lock.json"), versions = receipt.versions;
    for (const version of Object.values(versions)) assert(exact.test(version ?? ""), "Exact package versions are required");
    const scope = registry => ["--registry=" + PUBLIC_REGISTRY, "--@bitspark:registry=" + registry];
    receipt.phase = "published-metadata";
    const packages = {};
    for (const name of [...LOGOS_NAMES, ...ONTOS_NAMES]) {
      const privatePackage = LOGOS_NAMES.includes(name), registry = privatePackage ? LOGOS_REGISTRY : PUBLIC_REGISTRY;
      const version = privatePackage ? versions.logos : versions.ontos;
      packages[name] = publishedMetadata(JSON.parse(npm(["view", `${name}@${version}`, "--json", ...scope(registry)])), name, version, registry);
    }
    receipt.packages = packages;
    const intended = releasedManifest(original, versions, packages), temporary = installerManifest(intended, packages);
    intendedBytes = jsonBytes(intended);
    receipt.intendedManifestSha256 = digest(intendedBytes);
    receipt.installerManifest = temporary;
    const flags = ["--package-lock-only", "--ignore-scripts", "--allow-remote=all", "--no-audit", "--no-fund",
      "--package-lock=true", "--lockfile-version=3", "--omit-lockfile-registry-resolved=false", ...scope(PUBLIC_REGISTRY)];
    receipt.registrySelection = { public: npm(["config", "get", "@bitspark:registry", ...scope(PUBLIC_REGISTRY)]),
      logosMetadata: npm(["config", "get", "@bitspark:registry", ...scope(LOGOS_REGISTRY)]),
      omitLockfileRegistryResolved: npm(["config", "get", "omit-lockfile-registry-resolved", "--omit-lockfile-registry-resolved=false"]) };
    assert.deepEqual(receipt.registrySelection, { public: PUBLIC_REGISTRY, logosMetadata: LOGOS_REGISTRY, omitLockfileRegistryResolved: "false" });
    receipt.phase = "mixed-registry-resolution";
    writeFileSync("package.json", jsonBytes(temporary));
    npm(["install", ...flags]);
    const staged = parse("package-lock.json");
    receipt.stagedLockSha256 = fileIdentity("package-lock.json").sha256;
    receipt.phase = "offline-semver-reconciliation";
    writeFileSync("package.json", intendedBytes);
    // No explicit additions or update flag: npm reuses the URL-resolved nodes
    // satisfying the restored exact versions and regenerates only root specs.
    npm(["install", "--offline", ...flags]);
    receipt.phase = "resolution-verification";
    receipt.resolutions = inspectReleasedLock(before, staged, parse("package-lock.json"), intended, packages);
    assert.equal(readFileSync("package.json", "utf8"), intendedBytes, "npm changed the intended published manifest");
    const changed = git(["diff", "--name-only"]).split("\n").filter(Boolean);
    assert(changed.every(file => ["package.json", "package-lock.json"].includes(file)), "Unexpected source mutation");
    receipt.status = "source_refreshed"; receipt.phase = "complete";
    receipt.qualification = "pending complete committed-source package check";
  } catch (error) {
    receipt.failure = { name: error.name, detail: error.message };
    process.exitCode = 1;
  } finally {
    try {
      // Never leave temporary tarball dependency declarations in the source patch.
      if (intendedBytes) writeFileSync("package.json", intendedBytes);
      const patch = execFileSync("git", ["diff", "--binary", "--", "package.json", "package-lock.json"]);
      writeFileSync(join(output, "dependency.patch"), patch);
      receipt.patchSha256 = digest(patch);
      receipt.sourceFiles = Object.fromEntries(["package.json", "package-lock.json"].map(file => [file, fileIdentity(file).sha256]));
    } catch (error) {
      receipt.status = "incomplete";
      receipt.finalizationFailure = { name: error.name, detail: error.message };
      process.exitCode = 1;
    }
    writeFileSync(join(output, "receipt.json"), jsonBytes(receipt));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
