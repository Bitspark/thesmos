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
  /**
   * Logos's search budget. Memory is not among its bounds: Logos 0.23.0 runs the search in a
   * WebAssembly guest capped at 256 MiB, and `embedQuery` has no option to raise it (logos#3807).
   * A search that outgrows it fails as `not_completed`.
   */
  readonly limits?: EmbedRequest["limits"];
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
    facts: [anchor], goal: query.toGoal(), limits: request.limits,
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
  return encodeProof({ law: lawDigest, layer: layerDigest, bundles: request.bundles,
    derivation: new Derivation(nodes, derivation.root) });
}
