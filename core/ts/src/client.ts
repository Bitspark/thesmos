import {
  canonicalClauseId, ClauseId, Derivation, LeafNode, RuleNode, type Value,
} from "@bitspark/logos-contract";
import { embedQuery, type EmbedRequest } from "@bitspark/logos-kernel";
import { lawDigest, layerDigest } from "./data.js";
import { authorization, fact, inputLiteral } from "./encoding.js";
import { suppliedProgram } from "./program.js";
import { encodeProof } from "./proof.js";
import type { Query, SpaceFactsBundle } from "./types.js";

export interface ProveRequest {
  readonly root: Value;
  readonly query: Query;
  readonly bundles: readonly SpaceFactsBundle[];
  readonly limits?: EmbedRequest["limits"];
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
  if (outcome.kind !== "certified") throw new Error("Logos could not construct a certified proof", { cause: outcome });
  const result = outcome.outcome;
  const answers = result.kind === "solved" ? result.answers.answers
    : result.kind === "limit_exceeded" ? result.partial.answers : [];
  const answer = answers.find(candidate => candidate.claim.equals(query));
  if (!answer) throw new Error("No proof was found", { cause: outcome });

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
