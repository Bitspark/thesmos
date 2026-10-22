import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const ONTOS_NAMES = ["@bitspark/ontos-core", "@bitspark/ontos-codec", "@bitspark/ontos-data"];
export const LOGOS_NAMES = ["@bitspark/logos-contract", "@bitspark/logos-kernel"];
export const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
export const LOGOS_REGISTRY = "https://npm.pkg.github.com/";
const exact = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const json = file => JSON.parse(readFileSync(file, "utf8"));

export function fileIdentity(file) {
  const sha256 = createHash("sha256"), sha512 = createHash("sha512"), descriptor = openSync(file, "r");
  const chunk = Buffer.alloc(64 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const count = readSync(descriptor, chunk, 0, chunk.length, null);
      if (!count) break;
      bytes += count;
      sha256.update(chunk.subarray(0, count)); sha512.update(chunk.subarray(0, count));
    }
  } finally { closeSync(descriptor); }
  return { bytes, sha256: sha256.digest("hex"), integrity: "sha512-" + sha512.digest("base64") };
}

export function archiveManifest(file) {
  // Read one member without unpacking an untrusted archive into the workspace.
  const manifest = JSON.parse(execFileSync("tar", ["-xOf", file, "package/package.json"], { encoding: "utf8" }));
  return { manifest, ...fileIdentity(file) };
}

export function candidateCohort(archives) {
  assert.deepEqual(Object.keys(archives).sort(), [...LOGOS_NAMES].sort(), "Candidate archives must contain the exact Logos pair");
  let logosVersion, ontosVersion;
  for (const name of LOGOS_NAMES) {
    const manifest = archives[name].manifest;
    assert.equal(manifest?.name, name, "Candidate archive package name differs");
    assert(exact.test(manifest.version), "Candidate Logos version must be exact");
    assert(!logosVersion || logosVersion === manifest.version, "Candidate Logos versions differ");
    logosVersion = manifest.version;
    const dependencies = manifest.dependencies ?? {};
    assert.deepEqual(Object.keys(dependencies).filter(key => key.startsWith("@bitspark/ontos-")).sort(), [...ONTOS_NAMES].sort(),
      "Candidate Logos must declare the complete known Ontos cohort");
    for (const dependency of ONTOS_NAMES) {
      const version = dependencies[dependency];
      assert(/^\d+\.\d+\.\d+$/.test(version ?? ""), "Candidate Ontos versions must be exact stable releases");
      assert(!ontosVersion || ontosVersion === version, "Candidate Logos splits the Ontos cohort");
      ontosVersion = version;
    }
  }
  assert.equal(ontosVersion, "0.15.0", "This prepared candidate gate requires the reviewed Ontos 0.15.0 cohort");
  assert([logosVersion, "^" + logosVersion].includes(archives[LOGOS_NAMES[1]].manifest.dependencies[LOGOS_NAMES[0]]),
    "Candidate kernel must consume its paired contract version");
  return { logosVersion, ontosVersion };
}

export function publishedMetadata(metadata, name, version, registry = PUBLIC_REGISTRY) {
  assert.equal(metadata?.name, name, "Published package name differs");
  assert.equal(metadata.version, version, "Published package version differs");
  assert(exact.test(version), "Published dependency version must be exact");
  const url = new URL(metadata.dist?.tarball);
  assert.equal(url.protocol, "https:");
  assert.equal(url.origin + "/", registry);
  assert(!url.username && !url.password && !url.search && !url.hash, "Artifact URL must contain no credentials or query");
  assert(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist?.integrity ?? ""), "Published dependency lacks SHA-512 integrity");
  if (registry === PUBLIC_REGISTRY) {
    const short = name.slice(name.indexOf("/") + 1);
    assert.equal(url.href, `${registry}${name}/-/${short}-${version}.tgz`, "Unexpected public dependency artifact");
  } else {
    assert(url.pathname.startsWith(`/download/${name}/${version}/`), "Unexpected GitHub dependency artifact");
  }
  return { name, version, tarball: url.href, integrity: metadata.dist.integrity, dependencies: metadata.dependencies ?? {},
    ...(metadata.gitHead ? { gitHead: metadata.gitHead } : {}) };
}

export function candidateConsumer(manifest, archives, archivePaths) {
  const cohort = candidateCohort(archives), consumer = structuredClone(manifest);
  assert(!consumer.overrides, "Candidate gate refuses unknown existing dependency overrides");
  consumer.dependencies = { ...consumer.dependencies };
  consumer.devDependencies = { ...consumer.devDependencies };
  consumer.peerDependencies = { ...consumer.peerDependencies, [LOGOS_NAMES[1]]: cohort.logosVersion };
  consumer.dependencies[LOGOS_NAMES[0]] = pathToFileURL(archivePaths[LOGOS_NAMES[0]]).href;
  consumer.devDependencies[LOGOS_NAMES[1]] = pathToFileURL(archivePaths[LOGOS_NAMES[1]]).href;
  for (const name of ONTOS_NAMES) consumer.dependencies[name] = cohort.ontosVersion;
  // These explicit candidate-only overrides apply to the immutable packed
  // Thesmos declarations too. They never enter the published source manifest.
  consumer.overrides = Object.fromEntries([...LOGOS_NAMES, ...ONTOS_NAMES].map(name => [name, "$" + name]));
  return { consumer, cohort };
}

export function inspectCandidateLock(lock, archives, published) {
  const expected = new Set(ONTOS_NAMES.map(name => "node_modules/" + name));
  const found = Object.keys(lock.packages).filter(key => /(?:^|\/)node_modules\/@bitspark\/ontos-[^/]+$/.test(key));
  assert.deepEqual(found.sort(), [...expected].sort(), "The installed lock must have one physical Ontos cohort");
  assert.deepEqual(Object.keys(lock.packages).filter(key => /(?:^|\/)node_modules\/@bitspark\/logos-[^/]+$/.test(key)).sort(),
    LOGOS_NAMES.map(name => "node_modules/" + name).sort(), "The installed lock must contain only the exact root candidate Logos pair");
  const packages = {};
  for (const name of ONTOS_NAMES) {
    const row = lock.packages["node_modules/" + name], metadata = published[name];
    assert.equal(row.version, metadata.version); assert.equal(row.resolved, metadata.tarball);
    assert.equal(row.integrity, metadata.integrity); assert(!row.link);
    packages[name] = { version: row.version, resolved: row.resolved, integrity: row.integrity };
  }
  for (const name of LOGOS_NAMES) {
    const row = lock.packages["node_modules/" + name];
    assert.equal(row?.version, archives[name].manifest.version);
    assert.equal(row.integrity, archives[name].integrity, "Installed candidate bytes differ from the supplied archive");
    assert(!row.link && row.resolved?.startsWith("file:"), "Candidate Logos must be an installed archive, not a source link");
    packages[name] = { version: row.version, resolved: row.resolved, integrity: row.integrity };
  }
  return packages;
}

export async function installedOntosIdentity(directory, version) {
  const root = realpathSync(directory), physical = new Map(), seen = new Set(), modules = {}, origins = {};
  const within = file => {
    const actual = realpathSync(file), name = relative(root, actual);
    assert(name !== ".." && !name.startsWith(".." + sep) && !isAbsolute(name), "Installed package escapes the isolated consumer");
    return name.split(sep).join("/");
  };
  const census = directory => {
    if (!existsSync(directory)) return;
    const actual = realpathSync(directory); within(actual);
    if (seen.has(actual)) return;
    seen.add(actual);
    for (const item of readdirSync(actual, { withFileTypes: true })) {
      if (item.name.startsWith(".")) continue;
      const entry = join(actual, item.name);
      const packages = item.name.startsWith("@") ? readdirSync(entry).map(name => join(entry, name)) : [entry];
      for (const folder of packages) {
        if (!existsSync(join(folder, "package.json"))) continue;
        const info = json(join(folder, "package.json"));
        if (info.name?.startsWith("@bitspark/ontos-")) {
          assert(ONTOS_NAMES.includes(info.name) && info.version === version, "Unknown or stale installed Ontos package");
          const path = within(folder);
          assert(!physical.has(info.name) || physical.get(info.name) === path, "Multiple physical Ontos implementations");
          physical.set(info.name, path);
        }
        census(join(folder, "node_modules"));
      }
    }
  };
  census(join(root, "node_modules"));
  assert.equal(physical.size, ONTOS_NAMES.length, "Installed Ontos cohort is incomplete");
  const files = [join(root, "package.json"), join(root, "node_modules/@bitspark/thesmos/dist/core/ts/src/index.js")];
  for (const name of [...LOGOS_NAMES, ...ONTOS_NAMES]) files.push(createRequire(join(root, "package.json")).resolve(name));
  for (const file of files) {
    const require = createRequire(file), origin = within(file); origins[origin] = {};
    for (const name of ONTOS_NAMES) {
      const entry = realpathSync(require.resolve(name)), namespace = await import(pathToFileURL(entry).href);
      if (modules[name]) assert.equal(namespace, modules[name], "Distinct Ontos module/class namespace in installed consumer");
      modules[name] = namespace;
      origins[origin][name] = { entry: within(entry), sha256: fileIdentity(entry).sha256 };
    }
  }
  const core = modules[ONTOS_NAMES[0]], codec = modules[ONTOS_NAMES[1]];
  const value = core.tuple([core.atom(new Uint8Array([3, 8, 1, 6]))]), decoded = codec.decode(codec.encode(value));
  assert(decoded instanceof core.Tuple && decoded.at(0) instanceof core.Atom && core.equals(value, decoded),
    "Installed codec does not preserve the actual core class identity");
  return { version, physical: Object.fromEntries(physical), origins, transitiveNamespaceIdentity: true, codecClassIdentity: true };
}
