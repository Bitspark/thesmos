import {
  canonicalClauseId, ClauseId, Derivation, LeafNode, RuleNode, type Value,
} from "@bitspark/logos-contract";
import { embedQuery, type EmbedRequest, type KernelOutcome } from "@bitspark/logos-kernel";
import { lawDigest, layerDigest } from "./data.js";
import { authorization, fact, inputLiteral } from "./encoding.js";
import { suppliedProgram } from "./program.js";
import { encodeProof } from "./proof.js";
import type { Query, SpaceFactsBundle } from "./types.js";

export interface ProveRequest {
  readonly root: Value;
  readonly query: Query;
  readonly bundles: readonly SpaceFactsBundle[];
  /** Logos's search budget, including `memoryBytes`, the guest's live-allocation budget. */
  readonly limits?: EmbedRequest["limits"];
  /**
   * The search guest's memory ceiling in 64 KiB pages: 4096 (256 MiB) when unset, at most 16384
   * (1 GiB). A search that outgrows it fails as `not_completed`; Logos rejects invalid values.
   */
  readonly memoryLimitPages?: EmbedRequest["memoryLimitPages"];
}

/**
 * Why `prove` returned no proof. `exhausted`: the certified search drained its answer stream
 * without deriving the query from these bundles. `not_completed`: any other outcome, such as a
 * limit, cancellation, the memory ceiling, an engine failure or a request Logos refused, so the
 * search established nothing. Neither is a proof of prohibition.
 */
export type ProofSearchFailure = "exhausted" | "not_completed";

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
