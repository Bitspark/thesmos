import type { Atom, Clause, Derivation, Value } from "@bitspark/logos-contract";

/** All three fields are native Ontos values; space is a Logos path list. */
export interface Query {
  readonly actor: Value;
  readonly space: Value;
  readonly statement: Value;
}
export interface Proof {
  readonly law: Atom;
  readonly layer: Atom;
  readonly bundles: readonly SpaceFactsBundle[];
  readonly derivation: Derivation;
}
/** An asserter's live assertion at assertedAt; the time has no built-in policy. */
export interface SpaceFacts {
  readonly supplier: Value;
  readonly space: Value;
  readonly assertedAt: Value;
  /** Native counts(author, space, head) :- body inputs; facts have empty bodies. */
  readonly clauses: readonly Clause[];
}
/** Untrusted evidence until authentication and the Logos authority proof pass. */
export interface SpaceFactsBundle {
  readonly payload: Uint8Array;
  readonly authentication: Value;
}
/** Authenticate the claimed supplier over exactly these payload bytes. */
export type AuthenticateSpaceFacts = (request: SpaceFactsBundle & { readonly supplier: Value }) => boolean;
export interface Decision {
  readonly permitted: boolean;
  readonly code: string;
  readonly detail?: string;
  readonly checkedSteps?: number;
}
