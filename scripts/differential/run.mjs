import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The cross-language differential test: every receiver decides the same generated inputs, and
// permitted, code and checked steps must agree on each one. Run after `npm run build`, with Go,
// Rust (core/rs), Python (the installed thesmos extension plus cryptography) and the C++ decider
// (core/cpp's thesmos_differential, built by CMake with OpenSSL; THESMOS_CPP_DECIDER names it if
// it is not in core/cpp/build) available.
//
//   node scripts/differential/run.mjs [--seed N] [--count N] [--langs ts,go,rs,py,cpp] [--out DIR]
//
// It runs whatever the toolchains fetch; offline in CI (GOPROXY=off, CARGO_NET_OFFLINE=true).
const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const seed = arg("seed", "1"), count = arg("count", "1500"), langs = arg("langs", "ts,go,rs,py,cpp").split(",");
const out = arg("out", mkdtempSync(join(tmpdir(), "thesmos-differential-")));

const run = (command, args, options) => {
  const result = spawnSync(command, args, { maxBuffer: 1 << 28, encoding: "utf8", ...options });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.error}`);
  }
  return result.stdout;
};
process.stdout.write(run(process.execPath, [join(root, "scripts/differential/generate.mjs"), out, seed, count]));
const input = readFileSync(join(out, "cases.ontos")), kinds = JSON.parse(readFileSync(join(out, "kinds.json"), "utf8"));

const deciders = {
  ts: () => run(process.execPath, [join(root, "scripts/differential/decide-ts.mjs")], { input }),
  go: () => run("go", ["run", "./internal/differential"], { input, cwd: join(root, "core/go") }),
  rs: () => run("cargo", ["run", "--quiet", "--release", "--locked", "--example", "differential"], { input, cwd: join(root, "core/rs") }),
  py: () => run(process.env.PYTHON ?? "python", [join(root, "core/py/tests/differential.py")], { input }),
  cpp: () => run(process.env.THESMOS_CPP_DECIDER ?? join(root, "core/cpp/build/thesmos_differential"), [], { input }),
};
const decisions = {};
for (const lang of langs) {
  const lines = deciders[lang]().trim().split("\n").map(line => JSON.parse(line));
  if (lines.length !== kinds.length || lines.some((d, i) => d.i !== i)) throw new Error(`${lang}: ${lines.length} decisions for ${kinds.length} cases`);
  const panics = lines.filter(d => d.panicked);
  if (panics.length) throw new Error(`${lang} panicked on ${panics.length} cases, first ${kinds[panics[0].i]} (case ${panics[0].i})`);
  decisions[lang] = lines;
}

const key = d => `${d.permitted}/${d.code}/${d.steps}`;
const mismatches = [], codes = {};
for (let i = 0; i < kinds.length; i++) {
  const seen = Object.fromEntries(langs.map(lang => [lang, key(decisions[lang][i])]));
  if (new Set(Object.values(seen)).size > 1) mismatches.push({ i, kind: kinds[i], ...seen });
  const first = decisions[langs[0]][i];
  codes[first.code] = (codes[first.code] ?? 0) + 1;
}
console.log(`${kinds.length} cases, seed ${seed}, languages ${langs.join(", ")}: ${JSON.stringify(codes)}`);
if (mismatches.length) {
  console.error(`${mismatches.length} cases decided differently:`);
  for (const m of mismatches.slice(0, 25)) console.error(JSON.stringify(m));
  process.exit(1);
}
console.log("Every receiver decided every case identically (permitted, code and checked steps).");
