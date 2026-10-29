import {
  canonicalClauseId, ClauseId, Derivation, LeafNode, RuleNode, type Value,
} from "@bitspark/logos-contract";
import { embedQuery, RunLimits, type EmbedRequest, type KernelOutcome } from "@bitspark/logos-kernel";
import { decodeSpaceFacts } from "./bundles.js";
import { lawDigest, layerDigest } from "./data.js";
import { authorization, fact, inputLiteral } from "./encoding.js";
import { ProofProviderError, type ProofProviderFailure, type ProofSearchFailure } from "./failure.js";
import { suppliedProgram } from "./program.js";
import { encodeProof, ProofLimit } from "./proof.js";
import type { AuthenticateSpaceFacts, Query, SpaceFactsBundle } from "./types.js";
import type {
  ProducedProof, ProofBudget, ProofProvider, ProofRequest, ProofResult, SourceObservation,
} from "./wire.js";

export type { ProofSearchFailure } from "./failure.js";

export interface ProveRequest {
  readonly root: Value;
  readonly query: Query;
  readonly bundles: readonly SpaceFactsBundle[];
  /** Logos's search budget, including `memoryBytes`, the guest's live-allocation budget. */
  readonly limits?: EmbedRequest["limits"];
  /**
   * The search guest's memory ceiling in 64 KiB pages: 4096 (256 MiB) when unset, at most 16384
   * (1 GiB). A search that outgrows it fails as `not_completed`. A value outside 1..16384 makes
   * Logos throw a `RangeError` before any search, not a `ProofSearchError`.
   */
  readonly memoryLimitPages?: EmbedRequest["memoryLimitPages"];
}

/** The failure `prove` throws when it returns no proof. `cause` is the Logos outcome unchanged. */
export class ProofSearchError extends Error {
  declare readonly cause: KernelOutcome;
  static { this.prototype.name = "ProofSearchError"; }
  constructor(readonly reason: ProofSearchFailure, outcome: KernelOutcome) {
    super(reason === "exhausted" ? "No proof was found" : "Logos could not complete the proof search", { cause: outcome });
  }
}

/** Search is entirely Logos's. A failed search is not a proof of prohibition. */
export async function prove(request: ProveRequest, signal?: AbortSignal): Promise<Uint8Array> {
  const program = suppliedProgram(request.bundles);
  const anchor = inputLiteral(fact("root", request.root));
  const query = inputLiteral(authorization(request.query.actor, request.query.statement, request.query.space));
  const outcome = await embedQuery({
    rules: program.entries().map(([, clause]) => clause),
    facts: [anchor], goal: query.toGoal(), limits: request.limits, memoryLimitPages: request.memoryLimitPages,
  }, signal);
  if (outcome.kind !== "certified") throw new ProofSearchError("not_completed", outcome);
  const result = outcome.outcome;
  const answers = result.kind === "solved" ? result.answers.answers
    : result.kind === "limit_exceeded" ? result.partial.answers : [];
  const answer = answers.find(candidate => candidate.claim.equals(query));
  if (!answer) {
    const exhausted = result.kind !== "limit_exceeded" && result.completion === "exhausted";
    throw new ProofSearchError(exhausted ? "exhausted" : "not_completed", outcome);
  }

  // Logos references clauses by content; the existing wire uses the law's @id
  // and bundle positions. Only references change; terms and bindings stay native.
  const ids = new Map(program.entries().map(([id, clause]) => [canonicalClauseId(clause).asStr(), id]));
  const derivation = answer.certificate.derivation();
  const nodes = derivation.nodes.map(node => {
    if (node.kind !== "rule") return node;
    const id = ids.get(node.clause.asStr());
    if (id) return new RuleNode(node.conclusion, ClauseId.of(id), node.subst, node.premises);
    // The only external fact given to search is the receiver-configured anchor.
    if (node.conclusion.equals(anchor) && node.premises.length === 0) return new LeafNode(anchor);
    throw new Error("Logos proof names a clause outside the supplied program");
  });

  // Carry only the bundles the derivation uses, each whole: a bundle is signed as one
  // payload, so used bundles keep their exact bytes and unused ones are not disclosed.
  const bundleRef = /^bundle\/(\d+)\/(\d+)$/;
  const used = [...new Set(nodes.flatMap(node => {
    const match = node.kind === "rule" ? bundleRef.exec(node.clause.asStr()) : null;
    return match ? [Number(match[1])] : [];
  }))].sort((a, b) => a - b);
  const position = new Map(used.map((index, kept) => [index, kept]));
  const pruned = nodes.map(node => {
    if (node.kind !== "rule") return node;
    const match = bundleRef.exec(node.clause.asStr());
    return match ? new RuleNode(node.conclusion, ClauseId.of(`bundle/${position.get(Number(match[1]))}/${match[2]}`),
      node.subst, node.premises) : node;
  });
  return encodeProof({ law: lawDigest, layer: layerDigest, bundles: used.map(index => request.bundles[index]!),
    derivation: new Derivation(pruned, derivation.root) });
}

export interface AnswerOptions {
  /** Bundles the provider selected and may disclose, added after the caller's supplied ones. */
  readonly bundles?: readonly SpaceFactsBundle[];
  /** When set, every supplied bundle must authenticate, or the request is `invalid_request`. */
  readonly authenticate?: AuthenticateSpaceFacts;
  /** Descriptive source positions returned with a proof. */
  readonly observations?: readonly SourceObservation[];
  /** The provider's ceilings. A request's budget may lower them, never raise them. */
  readonly ceilings?: ProofBudget;
  readonly memoryLimitPages?: EmbedRequest["memoryLimitPages"];
  readonly signal?: AbortSignal;
}

const failure = (code: ProofProviderFailure, detail?: string): ProofResult =>
  detail === undefined ? { kind: "failure", code } : { kind: "failure", code, detail };
const lowest = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b);

/**
 * Answer one proof request with the existing producer. A provider calls this after its own caller
 * authentication, disclosure checks and record selection; it adds no authority decision.
 */
export async function answerProofRequest(request: ProofRequest, options: AnswerOptions = {}): Promise<ProofResult> {
  const supplied = request.bundles ?? [];
  if (options.authenticate) {
    for (const bundle of supplied) {
      let supplier;
      try { supplier = decodeSpaceFacts(bundle.payload).supplier; } catch { return failure("invalid_request", "a supplied bundle is malformed"); }
      if (options.authenticate({ ...bundle, supplier }) !== true) return failure("invalid_request", "a supplied bundle did not authenticate");
    }
  }
  const budget = request.budget ?? {}, ceilings = options.ceilings ?? {};
  const limits = {
    ...RunLimits.default(),
    wallClockMs: lowest(budget.deadlineMs, ceilings.deadlineMs),
    searchNodes: lowest(budget.searchNodes, ceilings.searchNodes),
    memoryBytes: lowest(budget.memoryBytes, ceilings.memoryBytes),
  };
  try {
    const proof = await prove({
      root: request.root, query: request.query, bundles: [...supplied, ...(options.bundles ?? [])],
      limits, memoryLimitPages: options.memoryLimitPages,
    }, options.signal);
    return { kind: "proof", proof, observations: options.observations ?? [] };
  } catch (error) {
    if (error instanceof ProofSearchError) return failure(error.reason);
    if (error instanceof ProofLimit) return failure("limit_exceeded", error.message);
    // The supplied program's structural checks: bad placement, body shape or clause encoding.
    if (error instanceof TypeError) return failure("invalid_request", error.message);
    throw error;
  }
}

/** The local twin of a remote provider: the same interface, with Logos in this process. */
export function createLocalProofProvider(options: Omit<AnswerOptions, "signal"> = {}): ProofProvider {
  return Object.freeze({
    async produce(request: ProofRequest, signal?: AbortSignal): Promise<ProducedProof> {
      const result = await answerProofRequest(request, signal ? { ...options, signal } : options);
      if (result.kind === "failure") throw new ProofProviderError(result.code, result.detail);
      return { proof: result.proof, observations: result.observations };
    },
  });
}
