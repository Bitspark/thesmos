import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { Atom, type Value } from "@bitspark/logos-contract";
import { encode } from "@bitspark/ontos-codec";
import { encodeSpaceFacts, type AuthenticateSpaceFacts, type SpaceFacts, type SpaceFactsBundle } from "../../src/index.js";

// PUBLIC DEMO KEYS, reproducible for native fixtures. These are not credentials.
// Applications supply their own identity/key resolution through the SDK adapter.
function exampleKey(identity: Value) {
  const seed = createHash("sha256").update("Spaces public example key\0").update(encode(identity)).digest();
  return createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der", type: "pkcs8",
  });
}
export function signExamplePayload(supplier: Value, payload: Uint8Array): SpaceFactsBundle {
  return { payload, authentication: new Atom(sign(null, payload, exampleKey(supplier))) };
}
export function signExampleFacts(output: SpaceFacts): SpaceFactsBundle {
  return signExamplePayload(output.supplier, encodeSpaceFacts(output));
}
export const authenticateExampleFacts: AuthenticateSpaceFacts = ({ supplier, payload, authentication }) =>
  authentication instanceof Atom && verify(null, payload, createPublicKey(exampleKey(supplier)), authentication.bytes());
