import {
  Atom, decodeDerivationWireV1Bounded, defaultLimits, GroundLiteral, Tuple, type Value,
} from "@bitspark/logos-contract";
import { decode, encode } from "@bitspark/ontos-codec";
import { encodeInt, encodeText, readInt, readText } from "@bitspark/ontos-data";
import protocol from "@bitspark/thesmos/law/protocol.json" with { type: "json" };
import { proofProviderFailures, type ProofProviderFailure } from "./failure.js";
import type { Query, SpaceFactsBundle } from "./types.js";

// Kernel-free and filesystem-free: this module only encodes, decodes and binds proof requests.

/**
 * Provider-neutral hints. `deadlineMs` is a duration in milliseconds that the provider counts from
 * receiving the request, queue time included. A provider may lower any hint and never raises one
 * above its own ceilings; a lower requested value is never increased.
 */
export interface ProofBudget {
  readonly deadlineMs?: number;
  readonly memoryBytes?: number;
  readonly searchNodes?: number;
}

/** A request to produce a native proof of one exact query under the caller's root. */
export interface ProofRequest {
  readonly root: Value;
  readonly query: Query;
  /** Signed evidence supplied by the caller, carried as exact payload and authentication bytes. */
  readonly bundles?: readonly SpaceFactsBundle[];
  /** An opaque, provider-defined reference to records the provider selects. */
  readonly selection?: Value;
  /** Native proofs presented for the provider's own disclosure checks of `selection`. */
  readonly disclosureProofs?: readonly Uint8Array[];
  readonly budget?: ProofBudget;
}

/**
 * Which source and position the provider read for the evidence it selected. Descriptive only: no
 * claim of currency, atomicity or acceptance, and nothing about bundles the caller supplied.
 */
export interface SourceObservation {
  readonly source: Value;
  readonly position: Value;
}

export type ProofResult =
  | { readonly kind: "proof"; readonly proof: Uint8Array; readonly observations: readonly SourceObservation[] }
  | { readonly kind: "failure"; readonly code: ProofProviderFailure; readonly detail?: string };

export interface ProducedProof {
  readonly proof: Uint8Array;
  readonly observations: readonly SourceObservation[];
}

/** One interface for local and remote production. Rejects with `ProofProviderError`. */
export interface ProofProvider {
  produce(request: ProofRequest, signal?: AbortSignal): Promise<ProducedProof>;
}

export const proofMediaType = "application/vnd.bitspark.spaces-proof+ontos";
// Matches the first provider's native request reader; raise both sides together, never one alone.
export const defaultMaxRequestBytes = 1024 * 1024;
export const defaultMaxResponseBytes = 2 * 1024 * 1024;

const symbol = (name: string) => new Atom(new TextEncoder().encode(name));
const requestTag = symbol("spaces/proof-request/1"), resultTag = symbol("spaces/proof-result/1");
const proofTag = symbol("proof"), failureTag = symbol("failure"), envelopeTag = symbol(protocol.format);
const optional = (value: Value | undefined) => new Tuple(value === undefined ? [] : [value]);
// Deadlines stay within what timers and the engine's clock conversion represent exactly.
export const maxDeadlineMs = 2_147_483_647;
const integer = (value: number | undefined, name: string) => {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  if (name === "deadlineMs" && value > maxDeadlineMs) throw new TypeError(`deadlineMs must not exceed ${maxDeadlineMs}`);
  return encodeInt(BigInt(value));
};

function tuple(value: Value | undefined, length?: number): Tuple {
  if (!(value instanceof Tuple) || (length !== undefined && value.length !== length)) throw new TypeError("Malformed proof wire value");
  return value;
}
function bytes(value: Value | undefined): Uint8Array {
  if (!(value instanceof Atom)) throw new TypeError("Expected native bytes");
  return value.bytes();
}
function readOptional(value: Value | undefined): Value | undefined {
  const items = tuple(value).items();
  if (items.length > 1) throw new TypeError("Malformed optional value");
  return items[0];
}
function readCount(value: Value | undefined): number | undefined {
  const present = readOptional(value);
  if (present === undefined) return undefined;
  const count = readInt(present);
  if (count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("Budget value out of range");
  return Number(count);
}
function readDeadline(value: Value | undefined): number | undefined {
  const deadline = readCount(value);
  if (deadline !== undefined && deadline > maxDeadlineMs) throw new TypeError("Deadline out of range");
  return deadline;
}
function decodeBounded(input: Uint8Array, maxBytes: number): Value {
  if (!(input instanceof Uint8Array)) throw new TypeError("Expected Ontos-encoded bytes");
  if (input.byteLength > maxBytes) throw new RangeError(`Wire value of ${input.byteLength} bytes exceeds ${maxBytes}`);
  return decode(input, {
    maxDepth: protocol.limits.maxWireDepth, maxAtomBytes: maxBytes, maxTupleArity: protocol.limits.maxProofSteps,
  });
}

export function encodeProofRequest(request: ProofRequest): Uint8Array {
  const { root, query } = request;
  const budget = request.budget ?? {};
  return encode(new Tuple([
    requestTag, root, new Tuple([query.actor, query.space, query.statement]),
    new Tuple((request.bundles ?? []).map(bundle => new Tuple([new Atom(bundle.payload), bundle.authentication]))),
    optional(request.selection),
    new Tuple((request.disclosureProofs ?? []).map(proof => new Atom(proof))),
    new Tuple([
      optional(integer(budget.deadlineMs, "deadlineMs")),
      optional(integer(budget.memoryBytes, "memoryBytes")),
      optional(integer(budget.searchNodes, "searchNodes")),
    ]),
  ]));
}

/** Decode a request within `maxBytes`. Throws on any malformed or oversized input. */
export function decodeProofRequest(input: Uint8Array, maxBytes = defaultMaxRequestBytes): ProofRequest {
  const value = tuple(decodeBounded(input, maxBytes), 7);
  if (!value.at(0)!.equals(requestTag)) throw new TypeError("Expected a spaces/proof-request/1 value");
  const [, root, query, bundles, selection, disclosure, budget] = value.items();
  const [actor, space, statement] = tuple(query, 3).items();
  const [deadlineMs, memoryBytes, searchNodes] = tuple(budget, 3).items();
  const present = <T extends object>(entries: T) =>
    Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined)) as T;
  return present({
    root: root!, query: { actor: actor!, space: space!, statement: statement! },
    bundles: tuple(bundles).items().map(entry => {
      const [payload, authentication] = tuple(entry, 2).items();
      return { payload: bytes(payload), authentication: authentication! };
    }),
    selection: readOptional(selection),
    disclosureProofs: tuple(disclosure).items().map(bytes),
    budget: present({ deadlineMs: readDeadline(deadlineMs), memoryBytes: readCount(memoryBytes), searchNodes: readCount(searchNodes) }),
  });
}

export function encodeProofResult(result: ProofResult): Uint8Array {
  if (result.kind === "proof") {
    return encode(new Tuple([resultTag, new Tuple([
      proofTag, new Atom(result.proof),
      new Tuple(result.observations.map(observation => new Tuple([observation.source, observation.position]))),
    ])]));
  }
  if (!proofProviderFailures.includes(result.code)) throw new TypeError(`Unknown proof provider failure ${result.code}`);
  return encode(new Tuple([resultTag, new Tuple([
    failureTag, symbol(result.code), optional(result.detail === undefined ? undefined : encodeText(result.detail)),
  ])]));
}

/** Decode a result within `maxBytes`. Throws on any malformed, oversized or unknown result. */
export function decodeProofResult(input: Uint8Array, maxBytes = defaultMaxResponseBytes): ProofResult {
  const value = tuple(decodeBounded(input, maxBytes), 2);
  if (!value.at(0)!.equals(resultTag)) throw new TypeError("Expected a spaces/proof-result/1 value");
  const outcome = tuple(value.at(1));
  if (outcome.at(0)?.equals(proofTag) && outcome.length === 3) {
    return {
      kind: "proof", proof: bytes(outcome.at(1)),
      observations: tuple(outcome.at(2)).items().map(entry => {
        const [source, position] = tuple(entry, 2).items();
        return { source: source!, position: position! };
      }),
    };
  }
  if (outcome.at(0)?.equals(failureTag) && outcome.length === 3) {
    const code = new TextDecoder("utf-8", { fatal: true }).decode(bytes(outcome.at(1))) as ProofProviderFailure;
    if (!proofProviderFailures.includes(code)) throw new TypeError(`Unknown proof provider failure ${code}`);
    const detail = readOptional(outcome.at(2));
    return detail === undefined ? { kind: "failure", code } : { kind: "failure", code, detail: readText(detail) };
  }
  throw new TypeError("Malformed proof result");
}

const derivationLimits = {
  ...defaultLimits(), maxNodes: protocol.limits.maxProofSteps,
  maxDepth: protocol.limits.maxProofDepth, maxTermDepth: protocol.limits.maxTermDepth,
};

/**
 * Whether a proof envelope concludes exactly this query from this root. An early consistency
 * check only: acceptance remains the receiver's verifier with its own root and actual query.
 */
export function proofConcludes(proof: Uint8Array, expected: { readonly root: Value; readonly query: Query }): boolean {
  try {
    const envelope = tuple(decodeBounded(proof, protocol.limits.maxProofBytes), 5);
    if (!envelope.at(0)!.equals(envelopeTag)) return false;
    const derivation = decodeDerivationWireV1Bounded(bytes(envelope.at(4)), derivationLimits);
    const { actor, statement, space } = expected.query;
    const conclusion = derivation.nodes[derivation.root]?.conclusion;
    if (!conclusion?.equals(GroundLiteral.of("authorized", [actor, statement, space]))) return false;
    const anchor = GroundLiteral.of("root", [expected.root]);
    const leaves = derivation.nodes.filter(node => node.kind === "leaf");
    return leaves.length > 0 && leaves.every(node => node.conclusion.equals(anchor));
  } catch {
    return false;
  }
}
