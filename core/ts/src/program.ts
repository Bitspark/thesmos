import { ClauseId } from "@bitspark/logos-contract";
import { loadLaw, protocol } from "./data.js";
import { decodeSpaceFacts } from "./bundles.js";
import { suppliedClause } from "./encoding.js";
import { ProofLimit } from "./proof.js";
import type { AuthenticateSpaceFacts, SpaceFactsBundle } from "./types.js";

/** Same guarded program on both sides. Authentication remains the receiver's job. */
export function suppliedProgram(bundles: readonly SpaceFactsBundle[], authenticate?: AuthenticateSpaceFacts) {
  const program = loadLaw();
  let count = 0;
  for (const [bundleIndex, bundle] of bundles.entries()) {
    const output = decodeSpaceFacts(bundle.payload);
    if (authenticate && authenticate({ ...bundle, supplier: output.supplier }) !== true) {
      throw new AuthenticationError("Space-facts output did not authenticate");
    }
    for (const [index, assertion] of output.clauses.entries()) {
      if (++count > protocol.limits.maxProofSteps) throw new ProofLimit("Bundled clause limit exceeded");
      program.insert(ClauseId.of(`bundle/${bundleIndex}/${index}`), suppliedClause(assertion, output.supplier, output.space));
    }
  }
  return program;
}

export class AuthenticationError extends Error {}
