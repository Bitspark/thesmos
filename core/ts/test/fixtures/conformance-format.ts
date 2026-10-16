import { Atom, Tuple, type Value } from "@bitspark/logos-contract";
import { decode, encode } from "@bitspark/ontos-codec";
import { encodeBool, encodeText, readBool, readText } from "@bitspark/ontos-data";
import { atom, lawDigest, type Query } from "../../src/index.js";
interface Case { name: string; why: string; root: Value; query: Query; proof: Uint8Array; permitted: boolean }

export const queryValue = (q: Query): Value => new Tuple([q.actor, q.space, q.statement]);
export function encodeCases(cases: readonly Case[]): Uint8Array {
  return encode(new Tuple([atom("spaces/conformance/2"), lawDigest, new Tuple(cases.map(c => new Tuple([
    encodeText(c.name), encodeText(c.why), c.root, queryValue(c.query), new Atom(c.proof), encodeBool(c.permitted),
  ])))]));
}
/** Fixture reader; conformance files are maintained repository data. */
export function decodeCases(bytes: Uint8Array): Case[] {
  const value = decode(bytes);
  if (!(value instanceof Tuple) || value.length !== 3 || !value.at(0)!.equals(atom("spaces/conformance/2")) || !value.at(1)!.equals(lawDigest)) throw new Error("Wrong conformance format or law");
  const entries = value.at(2);
  if (!(entries instanceof Tuple)) throw new Error("Invalid conformance cases");
  return entries.items().map(entry => {
    if (!(entry instanceof Tuple) || entry.length !== 6) throw new Error("Invalid case");
    const [n, w, root, q, proof, permitted] = entry.items();
    const name = readText(n!), why = readText(w!), expected = readBool(permitted!);
    if (name === undefined || why === undefined || expected === undefined || !(q instanceof Tuple) || q.length !== 3 || !(proof instanceof Atom)) throw new Error("Invalid case fields");
    return { name, why, root: root!, query: { actor: q.at(0)!, space: q.at(1)!, statement: q.at(2)! }, proof: proof.bytes(), permitted: expected };
  });
}
