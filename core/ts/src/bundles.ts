import { clauseFromValue, clauseValue, Tuple } from "@bitspark/logos-contract";
import { decode, encode } from "@bitspark/ontos-codec";
import { protocol } from "./data.js";
import { atom, listItems } from "./encoding.js";
import type { SpaceFacts } from "./types.js";

/** Sign/authenticate these bytes as a whole, including supplier, time and clauses. */
export function encodeSpaceFacts(output: SpaceFacts): Uint8Array {
  return encode(new Tuple([
    atom("space_facts"), output.supplier, output.space, output.assertedAt,
    new Tuple(output.clauses.map(clauseValue)),
  ]));
}

/** Decode evidence without treating its contents as established judgments. */
export function decodeSpaceFacts(bytes: Uint8Array): SpaceFacts {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > protocol.limits.maxProofBytes) throw new TypeError("Invalid space_facts payload size");
  const value = decode(bytes, {
    maxDepth: protocol.limits.maxWireDepth, maxAtomBytes: protocol.limits.maxProofBytes,
    maxTupleArity: protocol.limits.maxProofSteps,
  });
  if (!(value instanceof Tuple) || value.length !== 5 || !value.at(0)!.equals(atom("space_facts"))) throw new TypeError("Expected space_facts output");
  const [, supplier, space, assertedAt, clauses] = value.items();
  if (!(clauses instanceof Tuple)) throw new TypeError("Expected native clause tuple");
  listItems(space!);
  return {
    supplier: supplier!, space: space!, assertedAt: assertedAt!,
    clauses: clauses.items().map(value => {
      const clause = clauseFromValue(value);
      if (!clause) throw new TypeError("Expected a native Logos clause");
      return clause;
    }),
  };
}
