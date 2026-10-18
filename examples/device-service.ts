import { strict as assert } from "node:assert";
import { getPublicKey } from "@bitspark/archon";
import { Atom } from "@bitspark/logos-contract";
import { encodeInt } from "@bitspark/ontos-data";
import { atom, authorization, attributedClause, createSpacesVerifier, fact, path } from "@bitspark/thesmos";
import { authenticateArchon, signSpaceFacts } from "@bitspark/thesmos/archon";
import { prove } from "@bitspark/thesmos/client";

const seed = new Uint8Array(32).fill(7); // Synthetic example key.
const root = new Atom(getPublicKey(seed)), actor = atom("technician"), space = path("devices");
const statement = fact("temperature", atom("device7"), encodeInt(21n));
const bundles = [signSpaceFacts({ supplier: root, space, assertedAt: encodeInt(1792137600n),
  clauses: [attributedClause(root, space, authorization(actor, statement, space))],
}, seed)];
const query = { actor, statement, space };
const proof = await prove({ root, query, bundles });
const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
assert.equal(verifier.verify({ query, proof }).permitted, true);
assert.equal(verifier.verify({ query: { ...query, statement: fact("temperature", atom("device7"), encodeInt(99n)) }, proof }).permitted, false);
console.log("Device: the same law permits 21 degrees and rejects a changed operation.");
