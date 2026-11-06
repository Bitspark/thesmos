import { readFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto";
import { Atom } from "@bitspark/logos-contract";
import { decode, encode } from "@bitspark/ontos-codec";

// The TypeScript decider: reads cases.ontos on stdin, writes one JSON decision per line.
const root = new URL("../../", import.meta.url);
const { createSpacesVerifier } = await import(new URL("dist/core/ts/src/index.js", root));
const { authenticateArchon } = await import(new URL("dist/core/ts/src/archon.js", root));

function exampleKey(identity) {
  const seed = createHash("sha256").update("Spaces public example key\0").update(encode(identity)).digest();
  return createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
}
const authenticators = {
  example: ({ supplier, payload, authentication }) =>
    authentication instanceof Atom && verify(null, payload, createPublicKey(exampleKey(supplier)), authentication.bytes()),
  archon: authenticateArchon,
  accept: () => true,
};

const file = decode(readFileSync(0), { maxDepth: 4096 });
const lines = [];
for (const [i, entry] of file.at(2).items().entries()) {
  const [caseRoot, q, proof, auth] = entry.items();
  const authenticate = authenticators[new TextDecoder().decode(auth.bytes())];
  const d = createSpacesVerifier({ root: caseRoot, authenticate })
    .verify({ query: { actor: q.at(0), space: q.at(1), statement: q.at(2) }, proof: proof.bytes() });
  lines.push(JSON.stringify({ i, permitted: d.permitted, code: d.code, steps: d.permitted ? d.checkedSteps : 0 }));
}
process.stdout.write(lines.join("\n") + "\n");
