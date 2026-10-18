import { getPublicKey, signInDomain, verifyInDomain } from "@bitspark/archon";
import { Atom } from "@bitspark/logos-contract";
import { encodeSpaceFacts } from "./bundles.js";
import type { AuthenticateSpaceFacts, SpaceFacts, SpaceFactsBundle } from "./types.js";

/** This adapter's protocol domain, not an authority or freshness rule. */
export const spaceFactsDomain = "thesmos/space-facts/v1";

/** In this adapter a supplier identity is its exact 32-byte Archon public key. */
export const authenticateArchon: AuthenticateSpaceFacts = ({ supplier, payload, authentication }) =>
  supplier instanceof Atom && authentication instanceof Atom &&
  verifyInDomain(supplier.bytes(), spaceFactsDomain, payload, authentication.bytes());

/** Software-key convenience. Other custodians can sign these bytes in the same domain. */
export function signSpaceFacts(output: SpaceFacts, seed: Uint8Array): SpaceFactsBundle {
  if (!output.supplier.equals(new Atom(getPublicKey(seed)))) throw new TypeError("Seed does not identify this supplier");
  const payload = encodeSpaceFacts(output);
  return { payload, authentication: new Atom(signInDomain(seed, spaceFactsDomain, payload)) };
}
