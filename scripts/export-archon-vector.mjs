import { writeFileSync } from "node:fs";
import { Atom, Tuple } from "@bitspark/logos-contract";
import { encode } from "@bitspark/ontos-codec";

// Writes core/go/testdata/archon-document.ontos: (root, (actor, space, statement), proof) from the
// Archon-signed document example. The Go receiver must accept it and the TypeScript test suite
// checks that the committed bytes still verify, so both implementations accept the same proof.
// Run after `npm run build`; any valid proof of the example query is a valid vector.
const { root, runDocumentExample } = await import(new URL("../dist/examples/document-service.js", import.meta.url));
const { query, proof } = await runDocumentExample();
const bytes = encode(new Tuple([root, new Tuple([query.actor, query.space, query.statement]), new Atom(proof)]));
writeFileSync(new URL("../core/go/testdata/archon-document.ontos", import.meta.url), bytes);
console.log(`Wrote core/go/testdata/archon-document.ontos (${bytes.length} bytes).`);
