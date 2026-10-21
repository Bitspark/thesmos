import {
  AlwaysAdmit, check, PredicateSet, TermTheory,
  type CheckProfile, type Value,
} from "@bitspark/logos-contract";
import { lawDigest, layerDigest, protocol } from "./data.js";
import { authorization, fact, inputLiteral } from "./encoding.js";
import { suppliedProgram, AuthenticationError } from "./program.js";
import { checkLimits, decodeProof, ProofLimit } from "./proof.js";
import type { AuthenticateSpaceFacts, Decision, Query } from "./types.js";

export type { AuthenticateSpaceFacts, Decision, Proof, Query, SpaceFacts, SpaceFactsBundle } from "./types.js";
export type { Value } from "@bitspark/logos-contract";
export { lawDigest, layerDigest } from "./data.js";
export { atom, authorization, attributedClause, inspectAttributedClause, fact, list, path } from "./encoding.js";
export { encodeSpaceFacts, decodeSpaceFacts } from "./bundles.js";
export { encodeProof, decodeProof } from "./proof.js";

/** Verify the supplied evidence and finite proof. No temporal policy or search. */
export function createSpacesVerifier(config: { readonly root: Value; readonly authenticate: AuthenticateSpaceFacts }) {
  if (typeof config.authenticate !== "function") throw new TypeError("An authentication adapter is required");
  const anchor = inputLiteral(fact("root", config.root));
  const profile: CheckProfile<undefined> = {
    theory: new TermTheory(),
    leaves: {
      extensional: () => PredicateSet.from(["root"]),
      verify: claim => claim.equals(anchor)
        ? { kind: "admit" } : { kind: "reject", code: "unaccepted_premise" },
    },
    admit: new AlwaysAdmit<undefined>(),
    limits: checkLimits,
  };
  return Object.freeze({
    verify(request: { readonly query: Query; readonly proof: Uint8Array }): Decision {
      const reject = (code: string, detail: string): Decision => ({ permitted: false, code, detail });
      try {
        const proof = decodeProof(request.proof);
        if (!proof.law.equals(lawDigest)) return reject(protocol.results.lawMismatch, "Proof names another law");
        if (!proof.layer.equals(layerDigest)) return reject(protocol.results.layerMismatch, "Proof names another input layer");
        const program = suppliedProgram(proof.bundles, config.authenticate);
        const q = request.query;
        const verdict = check(program, inputLiteral(authorization(q.actor, q.statement, q.space)), proof.derivation, undefined, profile);
        if (verdict.kind === "reject") {
          const code = ["too_many_nodes", "too_deep", "term_too_deep"].includes(verdict.code) ? protocol.results.limit : protocol.results.rejected;
          return reject(code, verdict.code + ": " + verdict.detail);
        }
        return { permitted: true, code: protocol.results.permitted, checkedSteps: proof.derivation.nodes.length };
      } catch (error) {
        return reject(error instanceof AuthenticationError ? protocol.results.authentication
          : error instanceof ProofLimit ? protocol.results.limit : protocol.results.invalid,
          error instanceof Error ? error.message : "Invalid proof");
      }
    },
  });
}
