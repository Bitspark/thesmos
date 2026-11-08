// A consumer of the npm package, installed from a registry into a fresh directory by
// scripts/release/release.sh registries: it verifies the TypeScript-signed Archon proof, and the
// same proof with one changed byte is denied. Run it from that directory, so that its imports
// resolve to the installed packages.
import { readFileSync } from "node:fs";
import { decode } from "@bitspark/ontos-codec";
import { createSpacesVerifier } from "@bitspark/thesmos";
import { authenticateArchon } from "@bitspark/thesmos/archon";

const [root, q, proof] = decode(readFileSync(process.argv[2])).items();
const query = { actor: q.at(0), space: q.at(1), statement: q.at(2) };
const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
const bytes = proof.bytes(), changed = bytes.slice();
changed[changed.length >> 1] ^= 1;
const decision = verifier.verify({ query, proof: bytes }), denied = verifier.verify({ query, proof: changed });
console.log(`TypeScript: ${decision.code} after ${decision.checkedSteps} checked steps; with one byte changed, ${denied.code}`);
process.exit(decision.permitted && !denied.permitted ? 0 : 1);
