import {
  Atom, BoundedWireError, decodeDerivationWireV1Bounded,
  defaultLimits, encodeDerivationWireV1, Tuple,
} from "@bitspark/logos-contract";
import { decode, DecodeError, encode } from "@bitspark/ontos-codec";
import { protocol } from "./data.js";
import { atom } from "./encoding.js";
import type { Proof } from "./types.js";

export const checkLimits = {
  ...defaultLimits(), maxNodes: protocol.limits.maxProofSteps,
  maxDepth: protocol.limits.maxProofDepth, maxTermDepth: protocol.limits.maxTermDepth,
};
export class ProofLimit extends Error {}
/** Small Spaces envelope; clauses and derivations use Logos's standard formats. */
export function encodeProof(proof: Proof): Uint8Array {
  return encode(new Tuple([
    atom(protocol.format), proof.law, proof.layer,
    new Tuple(proof.bundles.map(bundle => new Tuple([new Atom(bundle.payload), bundle.authentication]))),
    new Atom(encodeDerivationWireV1(proof.derivation)),
  ]));
}
export function decodeProof(bytes: Uint8Array): Proof {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Proof must be Ontos-encoded bytes");
  if (bytes.byteLength > protocol.limits.maxProofBytes) throw new ProofLimit("Proof byte limit exceeded");
  try {
    const envelope = decode(bytes, {
      maxDepth: protocol.limits.maxWireDepth, maxAtomBytes: protocol.limits.maxProofBytes,
      maxTupleArity: protocol.limits.maxProofSteps,
    });
    if (!(envelope instanceof Tuple) || envelope.length !== 5 || !envelope.at(0)!.equals(atom(protocol.format))) throw new TypeError("Expected " + protocol.format + " envelope");
    const [law, layer, bundles, derivation] = envelope.items().slice(1);
    if (!(law instanceof Atom) || law.bytes().length !== 32 || !(layer instanceof Atom) || layer.bytes().length !== 32 || !(bundles instanceof Tuple) || !(derivation instanceof Atom)) throw new TypeError("Invalid proof envelope");
    const outputs = bundles.items().map(value => {
      if (!(value instanceof Tuple) || value.length !== 2 || !(value.at(0) instanceof Atom)) throw new TypeError("Expected authenticated space_facts bundle");
      return { payload: (value.at(0) as Atom).bytes(), authentication: value.at(1)! };
    });
    const account = decodeDerivationWireV1Bounded(derivation.bytes(), checkLimits);
    if (account.closedWorld.length || account.nodes.some(node => node.kind === "rule" && node.premises.some(p => typeof p !== "number"))) throw new TypeError("This experiment supports positive derivations only");
    return { law, layer, bundles: outputs, derivation: account };
  } catch (error) {
    if ((error instanceof DecodeError && error.code === "limit_exceeded") ||
        (error instanceof BoundedWireError && ["decode_stopped", "cert_wire_over_budget"].includes(error.kind))) throw new ProofLimit(error.message);
    throw error;
  }
}
