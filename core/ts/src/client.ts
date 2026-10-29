import {
  canonicalClauseId, ClauseId, Derivation, LeafNode, RuleNode, type Value,
} from "@bitspark/logos-contract";
import { embedQuery, RunLimits, type EmbedRequest, type KernelOutcome } from "@bitspark/logos-kernel";
import { decodeSpaceFacts } from "./bundles.js";
import { lawDigest, layerDigest } from "./data.js";
import { authorization, fact, inputLiteral } from "./encoding.js";
import { ProofProviderError, type ProofProviderFailure, type ProofSearchFailure } from "./failure.js";
import { suppliedProgram } from "./program.js";
import { decodeProof, encodeProof, ProofLimit } from "./proof.js";
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
  /**
   * Bundles the provider selected and may disclose, added after the caller's supplied ones. The
   * provider decides which supplied bundles it admits; a supplied copy of a bundle it no longer
   * selects is the caller's input, never part of its current selection.
   */
  readonly bundles?: readonly SpaceFactsBundle[];
  /**
   * Required, explicit: how supplied bundles are authenticated before search. A function rejects
   * any supplied bundle it does not accept as `invalid_request`. `null` skips the check; receivers
   * still authenticate every bundle a proof carries.
   */
  readonly authenticate: AuthenticateSpaceFacts | null;
  /**
   * Descriptive positions of the provider-selected evidence, returned with a proof. A function is
   * called after `revalidate`, so final reads (such as a recheck time) can be reported.
   */
  readonly observations?: readonly SourceObservation[] | (() => readonly SourceObservation[] | Promise<readonly SourceObservation[]>);
  /** The provider's ceilings. A request's budget may lower them, never raise them. */
  readonly ceilings?: ProofBudget;
  /** Time already spent on this request since receipt, such as queueing, deducted from its deadline. */
  readonly elapsedMs?: number;
  /**
   * Called after a successful search, before the proof is released. Returning false, for example
   * because the selection or the caller's disclosure authority changed, yields `evidence_changed`.
   */
  readonly revalidate?: () => boolean | Promise<boolean>;
  readonly memoryLimitPages?: EmbedRequest["memoryLimitPages"];
  /** Cooperative cancellation of the search. Terminating a worker remains the provider's own job. */
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
export async function answerProofRequest(request: ProofRequest, options: AnswerOptions): Promise<ProofResult> {
  if (options.authenticate !== null && typeof options.authenticate !== "function") {
    throw new TypeError("answerProofRequest needs an explicit authenticate function or null");
  }
  const supplied = request.bundles ?? [], selected = options.bundles ?? [];
  // The caller's inputs are checked on their own first, so a fault is attributed to whoever
  // supplied it: a malformed supplied bundle is the caller's `invalid_request`, while a fault in
  // the provider's own selection is rethrown for the provider to report.
  for (const bundle of supplied) {
    let supplier;
    try { supplier = decodeSpaceFacts(bundle.payload).supplier; } catch { return failure("invalid_request", "a supplied bundle is malformed"); }
    if (options.authenticate && options.authenticate({ ...bundle, supplier }) !== true) {
      return failure("invalid_request", "a supplied bundle did not authenticate");
    }
  }
  try { suppliedProgram(supplied); } catch (error) {
    if (error instanceof ProofLimit) return failure("limit_exceeded", "the supplied evidence exceeds the clause limit");
    return failure("invalid_request", "a supplied clause is malformed");
  }
  const budget = request.budget ?? {}, ceilings = options.ceilings ?? {};
  // Both deadlines count from receipt; what was already spent is not available to search.
  const deadline = lowest(budget.deadlineMs, ceilings.deadlineMs);
  const remaining = deadline === undefined ? undefined : deadline - (options.elapsedMs ?? 0);
  if (remaining !== undefined && remaining <= 0) return failure("not_completed", "the deadline passed before search");
  const limits = {
    ...RunLimits.default(),
    wallClockMs: remaining,
    searchNodes: lowest(budget.searchNodes, ceilings.searchNodes),
    memoryBytes: lowest(budget.memoryBytes, ceilings.memoryBytes),
  };
  let proof: Uint8Array;
  try {
    proof = await prove({
      root: request.root, query: request.query, bundles: [...supplied, ...selected],
      limits, memoryLimitPages: options.memoryLimitPages,
    }, options.signal);
  } catch (error) {
    if (error instanceof ProofSearchError) return failure(error.reason);
    if (error instanceof ProofLimit) return failure("limit_exceeded", "the supplied and selected evidence exceeds the clause limit");
    throw error; // A fault in the provider's selection or the engine is the provider's to report.
  }
  if (options.revalidate && await options.revalidate() !== true) {
    return failure("evidence_changed", "the selected evidence or its disclosure changed during search");
  }
  // Observations describe the selection, so they accompany only a proof that carries selected bytes.
  const selectedBytes = new Set(selected.map(bundle => Buffer.from(bundle.payload).toString("hex")));
  const usesSelection = decodeProof(proof).bundles.some(bundle => selectedBytes.has(Buffer.from(bundle.payload).toString("hex")));
  if (!usesSelection) return { kind: "proof", proof, observations: [] };
  const observations = typeof options.observations === "function" ? await options.observations() : options.observations ?? [];
  return { kind: "proof", proof, observations };
}

/** The local twin of a remote provider: the same interface, with Logos in this process. */
export function createLocalProofProvider(options: Omit<AnswerOptions, "signal">): ProofProvider {
  return Object.freeze({
    async produce(request: ProofRequest, signal?: AbortSignal): Promise<ProducedProof> {
      signal?.throwIfAborted();
      const result = await answerProofRequest(request, signal ? { ...options, signal } : options);
      // Caller cancellation rejects with the caller's own reason, as the HTTP provider does.
      signal?.throwIfAborted();
      if (result.kind === "failure") throw new ProofProviderError(result.code, result.detail);
      return { proof: result.proof, observations: result.observations };
    },
  });
}
