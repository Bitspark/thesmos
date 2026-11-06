import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Atom, Derivation, decodeDerivationWireV1Bounded, defaultLimits, encodeDerivationWireV1, Tuple } from "@bitspark/logos-contract";
import { decode, encode } from "@bitspark/ontos-codec";

// Writes the differential inputs: the frozen corpus, the Archon vector, and seeded mutations of
// them, as one Ontos value every receiver reads. Run after `npm run build`.
//
//   node scripts/differential/generate.mjs <out-dir> [seed] [mutations]
//
// <out-dir>/cases.ontos is ("thesmos/differential/1", seed, ((root, (actor, space, statement),
// proof, authenticator)...)), where authenticator is the symbol "example" (the corpus's public demo
// keys), "archon" (the Archon adapter) or "accept" (accepts every bundle, so altered payloads still
// reach the checker). <out-dir>/kinds.json names each case's origin for reports.
const root = new URL("../../", import.meta.url);
const { protocol } = await import(new URL("dist/core/ts/src/data.js", root));
const { decodeCases } = await import(new URL("dist/core/ts/test/fixtures/conformance-format.js", root));

const [out, seedText = "1", countText = "1500"] = process.argv.slice(2);
if (!out) throw new Error("usage: generate.mjs <out-dir> [seed] [mutations]");
const seed = Number(seedText) >>> 0, count = Number(countText);

// mulberry32: small, seeded and identical everywhere this script runs.
let state = seed || 1;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = items => items[Math.floor(random() * items.length)];
const int = n => Math.floor(random() * n);
const bytes = n => Uint8Array.from({ length: n }, () => int(256));
const symbol = text => new Atom(new TextEncoder().encode(text));

const bases = decodeCases(readFileSync(new URL("law/conformance.ontos", root))).map(c => ({
  name: c.name, root: c.root, query: c.query, proof: c.proof, auth: "example",
}));
{
  const vector = decode(readFileSync(new URL("core/go/testdata/archon-document.ontos", root)));
  const [vectorRoot, q, proof] = vector.items();
  bases.push({ name: "archon-document", root: vectorRoot, query: { actor: q.at(0), space: q.at(1), statement: q.at(2) }, proof: proof.bytes(), auth: "archon" });
}

// The envelope as plain Ontos parts, so edits can leave it decodable or break it on purpose.
const parts = proof => [...decode(proof).items()];
const assemble = ([format, law, layer, bundles, derivation]) => encode(new Tuple([format, law, layer, bundles, derivation]));
const bundlesOf = p => [...p[3].items()];
const withBundles = (p, bundles) => assemble([p[0], p[1], p[2], new Tuple(bundles), p[4]]);
const nested = depth => { let v = symbol("x"); for (let i = 0; i < depth; i++) v = new Tuple([v]); return v; };
const derivationOf = p => decodeDerivationWireV1Bounded(p[4].bytes(), { ...defaultLimits(), maxNodes: 1 << 20, maxDepth: 1 << 20 });
const withDerivation = (p, d) => assemble([p[0], p[1], p[2], p[3], new Atom(encodeDerivationWireV1(d))]);
const flip = (data, at = int(data.length)) => { const c = Uint8Array.from(data); c[at] ^= 1 << int(8); return c; };
const spaceFacts = payload => [...decode(payload).items()];

const mutations = {
  "byte-flip": b => ({ proof: flip(b.proof) }),
  "byte-insert": b => { const at = int(b.proof.length + 1); return { proof: Uint8Array.from([...b.proof.slice(0, at), int(256), ...b.proof.slice(at)]) }; },
  "byte-delete": b => { const at = int(b.proof.length); return { proof: Uint8Array.from([...b.proof.slice(0, at), ...b.proof.slice(at + 1)]) }; },
  "truncate": b => ({ proof: b.proof.slice(0, int(b.proof.length)) }),
  "law": b => { const p = parts(b.proof); p[1] = new Atom(pick([bytes(32), bytes(31), bytes(33)])); return { proof: assemble(p) }; },
  "layer": b => { const p = parts(b.proof); p[2] = new Atom(pick([bytes(32), bytes(31)])); return { proof: assemble(p) }; },
  "format": b => { const p = parts(b.proof); p[0] = symbol(pick(["spaces/proof/5", "spaces/proof/7", ""])); return { proof: assemble(p) }; },
  "drop-bundle": b => { const p = parts(b.proof), list = bundlesOf(p); list.splice(int(list.length), 1); return { proof: withBundles(p, list) }; },
  "dup-bundle": b => { const p = parts(b.proof), list = bundlesOf(p); list.splice(int(list.length + 1), 0, pick(list)); return { proof: withBundles(p, list) }; },
  "swap-bundles": b => { const p = parts(b.proof), list = bundlesOf(p); const i = int(list.length), j = int(list.length); [list[i], list[j]] = [list[j], list[i]]; return { proof: withBundles(p, list) }; },
  "splice-bundle": b => { const p = parts(b.proof), list = bundlesOf(p), other = bundlesOf(parts(pick(bases).proof)); list[int(list.length)] = pick(other); return { proof: withBundles(p, list) }; },
  "payload-flip": b => { const p = parts(b.proof), list = bundlesOf(p), i = int(list.length); list[i] = new Tuple([new Atom(flip(list[i].at(0).bytes())), list[i].at(1)]); return { proof: withBundles(p, list), auth: "accept" }; },
  "payload-edit": b => {
    const p = parts(b.proof), list = bundlesOf(p), i = int(list.length), facts = spaceFacts(list[i].at(0).bytes());
    const clauses = [...facts[4].items()], edit = int(5);
    if (edit === 0) facts[1] = pick(bases).root;
    else if (edit === 1) facts[2] = pick(bases).query.space;
    else if (edit === 2) facts[3] = symbol("another time");
    else if (edit === 3 && clauses.length) { clauses.splice(int(clauses.length), 1); facts[4] = new Tuple(clauses); }
    else if (clauses.length) { clauses.push(pick(clauses)); facts[4] = new Tuple(clauses); }
    list[i] = new Tuple([new Atom(encode(new Tuple(facts))), list[i].at(1)]);
    return { proof: withBundles(p, list), auth: "accept" };
  },
  "authentication": b => { const p = parts(b.proof), list = bundlesOf(p), i = int(list.length); list[i] = new Tuple([list[i].at(0), pick([new Tuple([]), new Atom(bytes(64)), new Atom(bytes(63))])]); return { proof: withBundles(p, list) }; },
  "derivation-flip": b => { const p = parts(b.proof); p[4] = new Atom(flip(p[4].bytes())); return { proof: assemble(p) }; },
  "derivation-nodes": b => {
    const p = parts(b.proof), d = derivationOf(p), nodes = [...d.nodes], edit = int(4);
    if (edit === 0) nodes.splice(int(nodes.length), 1);
    else if (edit === 1) nodes.splice(int(nodes.length + 1), 0, pick(nodes));
    else if (edit === 2) { const i = int(nodes.length), j = int(nodes.length); [nodes[i], nodes[j]] = [nodes[j], nodes[i]]; }
    return { proof: withDerivation(p, new Derivation(nodes, edit === 3 ? int(nodes.length + 2) : Math.min(d.root, Math.max(0, nodes.length - 1)))) };
  },
  "query": b => {
    const other = pick(bases).query, query = { ...b.query }, field = pick(["actor", "space", "statement"]);
    query[field] = pick([other[field], symbol("x"), new Tuple([])]);
    return { query };
  },
  "root": () => ({ root: pick(bases).root }),
};

// Values on each limit, and one past it: the receivers must agree on both sides of every bound.
function boundaries() {
  const cases = [], base = bases.find(b => b.auth === "example" && b.proof.length > 2000) ?? bases[0];
  const p = parts(base.proof), { maxProofBytes, maxWireDepth, maxProofSteps, maxTermDepth } = protocol.limits;
  for (const extra of [0, 1]) {
    // Proof bytes: pad one bundle's authentication until the envelope is exactly at, or one over, the limit.
    let pad = maxProofBytes - base.proof.length, proof;
    for (let round = 0; round < 8; round++) {
      const list = bundlesOf(p); list[0] = new Tuple([list[0].at(0), new Atom(new Uint8Array(Math.max(0, pad)))]);
      proof = withBundles(p, list);
      const delta = maxProofBytes + extra - proof.length;
      if (delta === 0) break;
      pad += delta;
    }
    cases.push({ kind: `proof-bytes-${extra ? "over" : "at"}`, ...base, proof, auth: "accept" });
    // Wire depth: nesting inside an authentication value, at and one past the decoder's bound.
    const list = bundlesOf(p); list[0] = new Tuple([list[0].at(0), nested(maxWireDepth - 3 + extra)]);
    cases.push({ kind: `wire-depth-${extra ? "over" : "at"}`, ...base, proof: withBundles(p, list), auth: "accept" });
    // Derivation nodes: exactly the step limit, and one more.
    const d = derivationOf(p), nodes = [...d.nodes];
    while (nodes.length < maxProofSteps + extra) nodes.push(nodes[0]);
    cases.push({ kind: `nodes-${extra ? "over" : "at"}`, ...base, proof: withDerivation(p, new Derivation(nodes.slice(0, maxProofSteps + extra), d.root)) });
    // Bundled clauses across two bundles: the limit, and one more.
    const facts = spaceFacts(list[0].at(0).bytes()), clauses = [...facts[4].items()], half = Math.ceil((maxProofSteps + extra) / 2);
    const filled = n => { const c = []; while (c.length < n) c.push(clauses[c.length % clauses.length]); return new Atom(encode(new Tuple([...facts.slice(0, 4), new Tuple(c)]))); };
    const bundles = [new Tuple([filled(half), symbol("unsigned")]), new Tuple([filled(maxProofSteps + extra - half), symbol("unsigned")])];
    cases.push({ kind: `clauses-${extra ? "over" : "at"}`, ...base, proof: withBundles(p, bundles), auth: "accept" });
    // Claim term depth: a statement nested to the checker's term bound, and one past it.
    cases.push({ kind: `term-depth-${extra ? "over" : "at"}`, ...base, query: { ...base.query, statement: nested(maxTermDepth - 1 + extra) } });
  }
  return cases;
}

const cases = [];
for (const b of bases) {
  cases.push({ kind: `corpus:${b.name}`, ...b });
  cases.push({ kind: `corpus-accept:${b.name}`, ...b, auth: "accept" });
}
cases.push(...boundaries());
const kinds = Object.keys(mutations);
for (let n = 0; n < count; n++) {
  const base = pick(bases), kind = pick(kinds);
  let edit;
  try { edit = mutations[kind](base); } catch { continue; } // a recipe that does not apply to this base
  const auth = edit.auth ?? (random() < 0.3 ? "accept" : base.auth);
  cases.push({ kind: `${kind}:${base.name}`, root: edit.root ?? base.root, query: edit.query ?? base.query, proof: edit.proof ?? base.proof, auth });
}

const value = new Tuple([symbol("thesmos/differential/1"), new Atom(new TextEncoder().encode(String(seed))), new Tuple(cases.map(c =>
  new Tuple([c.root, new Tuple([c.query.actor, c.query.space, c.query.statement]), new Atom(c.proof), symbol(c.auth)])))]);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/cases.ontos`, encode(value));
writeFileSync(`${out}/kinds.json`, JSON.stringify(cases.map(c => c.kind)));
console.log(`Wrote ${cases.length} differential cases (seed ${seed}) to ${out}/cases.ontos.`);
