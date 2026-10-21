import { Atom, Tuple, type Value } from "@bitspark/logos-contract";
import { encodeText, readText } from "@bitspark/ontos-data";

const tag = new Atom(new TextEncoder().encode("thesmos/issuer-subject/1"));

/** An optional identity profile. Encoding an issuer/subject pair does not authenticate it. */
export function issuerSubjectPrincipal(issuer: string, subject: string): Value {
  if (typeof issuer !== "string" || issuer.length === 0 ||
      typeof subject !== "string" || subject.length === 0) {
    throw new TypeError("Issuer and subject must be nonempty text");
  }
  // Native text rejects unpaired surrogates and preserves every Unicode scalar.
  return new Tuple([tag, encodeText(issuer), encodeText(subject)]);
}

/** Decode only this exact profile; no key aliases or normalization. */
export function decodeIssuerSubjectPrincipal(value: Value): { issuer: string; subject: string } {
  if (!(value instanceof Tuple) || value.length !== 3 || !value.at(0)!.equals(tag)) {
    throw new TypeError("Expected an issuer-subject principal");
  }
  const issuer = readText(value.at(1)!), subject = readText(value.at(2)!);
  if (issuer.length === 0 || subject.length === 0) throw new TypeError("Issuer and subject must be nonempty text");
  return { issuer, subject };
}
