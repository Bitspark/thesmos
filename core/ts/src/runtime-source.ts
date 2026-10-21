import { createHash } from "node:crypto";
import {
  Atom, ClauseId, DERIVATION_WIRE_V1_TAG, Derivation, MapProgram, RuleNode, Tuple, clauseFromValue, clauseValue, programBytes, programFromValue,
  type Clause, type Value,
} from "@bitspark/logos-contract";
import { DecodeError, decode, encode, encodeUvarint } from "@bitspark/ontos-codec";
import { decodeSpaceFacts } from "./bundles.js";
import { loadLaw, lawDigest, layerDigest, protocol } from "./data.js";
import { atom, suppliedClause } from "./encoding.js";
import { createSpacesVerifier } from "./index.js";
import { encodeProof } from "./proof.js";
import type { AuthenticateSpaceFacts, Query, SpaceFactsBundle } from "./types.js";

/** Acquisition limits are independent of the frozen portable-proof limits. */
export interface PreparationBudget {
  readonly maxBundles: number;
  readonly maxClauses: number;
  readonly maxPayloadBytes: number;
}
export interface CarryingBudget {
  readonly maxBytes?: number;
  readonly maxClauses?: number;
  readonly maxSteps?: number;
}
export class PreparationRefused extends Error {
  constructor(readonly code: "budget" | "authentication" | "invalid-input", detail: string) {
    super(detail);
    this.name = "PreparationRefused";
  }
}
type Source = {
  readonly key: string;
  readonly bundle: SpaceFactsBundle;
  readonly clauses: number;
  readonly encodedBytes: number;
  readonly portable: boolean;
};
type ClauseSource = { readonly source: Source; readonly index: number };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const copyBundle = (bundle: SpaceFactsBundle): SpaceFactsBundle => ({
  payload: Uint8Array.from(bundle.payload), authentication: decode(encode(bundle.authentication)),
});
const validBound = (n: number) => Number.isSafeInteger(n) && n >= 0;
const portableSource = (bytes: Uint8Array): boolean => {
  try {
    // The final envelope and bundle collection add two enclosing tuples. Payload
    // bytes remain opaque here; decodeSpaceFacts already checked their own limits.
    decode(bytes, { maxDepth: protocol.limits.maxWireDepth - 2,
      maxTupleArity: protocol.limits.maxProofSteps, maxAtomBytes: protocol.limits.maxProofBytes });
    return true;
  } catch (error) {
    if (error instanceof DecodeError && error.code === "limit_exceeded") return false;
    throw error;
  }
};

/**
 * Exact authenticated selected sources and their guarded native clauses. This object
 * makes no authority decision. Each source remains available whole for later export.
 */
export class SpacesProgram {
  readonly #program: MapProgram;
  readonly #programBytes: Uint8Array;
  readonly #sources: ReadonlyMap<string, ClauseSource>;
  readonly #bundles: readonly Source[];
  readonly identity: string;
  readonly clauseCount: number;
  readonly payloadBytes: number;

  private constructor(program: MapProgram, sources: Map<string, ClauseSource>, bundles: Source[], bytes: number) {
    this.#program = program;
    this.#programBytes = programBytes(program);
    this.#sources = sources;
    this.#bundles = bundles;
    this.identity = sha256(this.#programBytes);
    this.clauseCount = sources.size;
    this.payloadBytes = bytes;
  }

  static prepare(request: {
    readonly bundles: readonly SpaceFactsBundle[];
    readonly authenticate: AuthenticateSpaceFacts;
    readonly budget: PreparationBudget;
    readonly includeLaw: boolean;
  }): SpacesProgram {
    const { budget } = request;
    if (typeof request.authenticate !== "function" ||
        ![budget.maxBundles, budget.maxClauses, budget.maxPayloadBytes].every(validBound)) {
      throw new PreparationRefused("invalid-input", "An authenticator and finite acquisition bounds are required");
    }
    if (request.bundles.length > budget.maxBundles) throw new PreparationRefused("budget", "Selected bundle limit exceeded");
    const program = request.includeLaw ? loadLaw() : new MapProgram();
    const sources = new Map<string, ClauseSource>(), unique = new Map<string, Source>();
    let count = 0, bytes = 0;
    for (const supplied of request.bundles) {
      bytes += supplied.payload.byteLength;
      if (!Number.isSafeInteger(bytes) || bytes > budget.maxPayloadBytes) throw new PreparationRefused("budget", "Selected payload limit exceeded");
      const bundle = copyBundle(supplied);
      const output = decodeSpaceFacts(bundle.payload);
      if (request.authenticate({ ...copyBundle(bundle), supplier: decode(encode(output.supplier)) }) !== true) {
        throw new PreparationRefused("authentication", "Selected space-facts output did not authenticate");
      }
      count += output.clauses.length;
      if (!Number.isSafeInteger(count) || count > budget.maxClauses) throw new PreparationRefused("budget", "Selected clause limit exceeded");
      // Authentication is part of source identity, even when executable clauses coincide.
      const sourceBytes = encode(new Tuple([new Atom(bundle.payload), bundle.authentication]));
      const sourceKey = sha256(sourceBytes);
      if (unique.has(sourceKey)) continue;
      const source: Source = { key: sourceKey, bundle, clauses: output.clauses.length,
        encodedBytes: sourceBytes.byteLength, portable: portableSource(sourceBytes) };
      unique.set(sourceKey, source);
      for (const [index, assertion] of output.clauses.entries()) {
        const id = `supplied/${sourceKey}/${index}`;
        program.insert(ClauseId.of(id), suppliedClause(assertion, output.supplier, output.space));
        sources.set(id, { source, index });
      }
    }
    return new SpacesProgram(program, sources, [...unique.values()], bytes);
  }

  /** Decode a defensive view: even mutable Term atom bytes cannot alter the capture. */
  nativeProgram(): MapProgram {
    return programFromValue(decode(this.#programBytes));
  }

  selectedBundles(): readonly SpaceFactsBundle[] { return this.#bundles.map(source => copyBundle(source.bundle)); }
  sourceCosts(): readonly { readonly clauseId: string; readonly group: string; readonly encodedBytes: number; readonly clauses: number; readonly portable: boolean }[] {
    return [...this.#sources].map(([clauseId, { source }]) => ({ clauseId, group: source.key,
      encodedBytes: source.encodedBytes, clauses: source.clauses, portable: source.portable }));
  }
  source(id: string): { readonly key: string; readonly index: number; readonly clauses: number; readonly bundle: SpaceFactsBundle } | undefined {
    const found = this.#sources.get(id);
    if (!found) return;
    const source = found.source;
    return { key: source.key, index: found.index, clauses: source.clauses,
      get bundle() { return copyBundle(source.bundle); } };
  }
  clause(id: string): Clause | undefined {
    const clause = this.#program.clause(ClauseId.of(id));
    return clause && clauseFromValue(decode(encode(clauseValue(clause))));
  }
}

export function prepareSpacesProgram(request: {
  readonly bundles: readonly SpaceFactsBundle[];
  readonly authenticate: AuthenticateSpaceFacts;
  readonly budget: PreparationBudget;
}): SpacesProgram { return SpacesProgram.prepare({ ...request, includeLaw: true }); }

/** Every observation remains a guarded clause; no assertion becomes an extensional leaf. */
export function prepareSpacesOverlay(request: {
  readonly bundles: readonly SpaceFactsBundle[];
  readonly authenticate: AuthenticateSpaceFacts;
  readonly budget: PreparationBudget;
}): SpacesProgram { return SpacesProgram.prepare({ ...request, includeLaw: false }); }

export type SpacesExport =
  | { readonly kind: "exported"; readonly proof: Uint8Array; readonly bundles: number; readonly clauses: number; readonly steps: number }
  | { readonly kind: "unavailable"; readonly reason: "unselected-source" | "carrying-limit" | "invalid-witness"; readonly detail: string };

/**
 * Frozen Ontos v1 uses tag + unsigned-LEB128 length/arity, then child bytes.
 * Bundle children are charged whole separately; unwrapped FIRM account payload
 * bytes are charged by the provider. Spaces adds the public derivation wire tag
 * and tuple around that payload. This is the remaining envelope overhead at the
 * maximum permitted bundle count and account length, both monotone bounds.
 */
export function portableEnvelopeReserve(maxAccountBytes: number, maxGroups: number): number {
  if (![maxAccountBytes, maxGroups].every(validBound)) throw new TypeError("Finite envelope bounds are required");
  const header = (n: number) => 1 + encodeUvarint(n).byteLength;
  const accountWrapper = header(2) + encode(atom(DERIVATION_WIRE_V1_TAG)).byteLength;
  const maxWireBytes = maxAccountBytes + accountWrapper;
  if (!validBound(maxWireBytes)) throw new TypeError("Account wire bound exceeds a safe integer");
  return header(5) + encode(atom(protocol.format)).byteLength + encode(lawDigest).byteLength +
    encode(layerDigest).byteLength + header(maxGroups) + header(maxWireBytes) + accountWrapper;
}

/** Reconstruct the envelope from recorded inference only, then independently check it. */
export function exportSpacesProof(request: {
  readonly root: Value;
  readonly query: Query;
  readonly programs: readonly SpacesProgram[];
  readonly derivation: Derivation;
  readonly authenticate: AuthenticateSpaceFacts;
  readonly budget?: CarryingBudget;
}): SpacesExport {
  const unavailable = (reason: "unselected-source" | "carrying-limit" | "invalid-witness", detail: string): SpacesExport => ({ kind: "unavailable", reason, detail });
  const maxBytes = request.budget?.maxBytes ?? protocol.limits.maxProofBytes;
  const maxClauses = request.budget?.maxClauses ?? protocol.limits.maxProofSteps;
  const maxSteps = request.budget?.maxSteps ?? protocol.limits.maxProofSteps;
  if (![maxBytes, maxClauses, maxSteps].every(validBound) || maxBytes > protocol.limits.maxProofBytes ||
      maxClauses > protocol.limits.maxProofSteps || maxSteps > protocol.limits.maxProofSteps) {
    return unavailable("carrying-limit", "A carrying budget may tighten, but cannot enlarge, the portable limits");
  }
  if (request.derivation.nodes.length > maxSteps) return unavailable("carrying-limit", "Proof step limit exceeded");
  if (request.derivation.closedWorld.length || request.derivation.nodes.some(node => node.kind === "rule" && node.premises.some(p => typeof p !== "number")))
    return unavailable("invalid-witness", "The Spaces envelope requires a positive derivation");
  const law = loadLaw(), carried = new Map<string, { bundle: SpaceFactsBundle; clauses: number }>();
  const refs = new Map<string, { key: string; index: number }>();
  for (const node of request.derivation.nodes) {
    if (node.kind !== "rule") continue;
    const id = node.clause.asStr();
    if (law.clause(node.clause)) continue;
    if (refs.has(id)) continue;
    const source = request.programs.map(program => program.source(id)).find(value => value !== undefined);
    if (!source) return unavailable("unselected-source", `Witness source is not in the pinned selection: ${id}`);
    if (!carried.has(source.key)) carried.set(source.key, { bundle: source.bundle, clauses: source.clauses });
    refs.set(id, { key: source.key, index: source.index });
  }
  const ordered = [...carried.entries()].sort(([a], [b]) => a.localeCompare(b));
  const clauses = ordered.reduce((sum, [, source]) => sum + source.clauses, 0);
  if (clauses > maxClauses) return unavailable("carrying-limit", "Whole carried bundles exceed the clause limit");
  const positions = new Map(ordered.map(([key], index) => [key, index]));
  // The native budget measures original FIRM account bytes. Replacing our exact
  // source IDs by portable positions must never enlarge any encoded atom.
  for (const [id, ref] of refs) {
    const portable = `bundle/${positions.get(ref.key)}/${ref.index}`;
    if (new TextEncoder().encode(portable).byteLength > new TextEncoder().encode(id).byteLength)
      return unavailable("invalid-witness", "Portable source identity would enlarge the measured account");
  }
  const nodes = request.derivation.nodes.map(node => {
    if (node.kind !== "rule") return node;
    const ref = refs.get(node.clause.asStr());
    return ref ? new RuleNode(node.conclusion, ClauseId.of(`bundle/${positions.get(ref.key)}/${ref.index}`), node.subst, node.premises, node.meta) : node;
  });
  try {
    const proof = encodeProof({ law: lawDigest, layer: layerDigest,
      bundles: ordered.map(([, source]) => source.bundle), derivation: new Derivation(nodes, request.derivation.root) });
    if (proof.byteLength > maxBytes) return unavailable("carrying-limit", "Encoded proof exceeds the byte limit");
    const verdict = createSpacesVerifier({ root: request.root, authenticate: request.authenticate }).verify({ query: request.query, proof });
    if (!verdict.permitted) return unavailable("invalid-witness", `${verdict.code}: ${verdict.detail ?? "rejected"}`);
    return { kind: "exported", proof, bundles: ordered.length, clauses, steps: nodes.length };
  } catch (error) {
    return unavailable("invalid-witness", error instanceof Error ? error.message : "Witness encoding failed");
  }
}
