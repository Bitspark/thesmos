import { strict as assert } from "node:assert";
import { getPublicKey } from "@bitspark/archon";
import { Atom } from "@bitspark/logos-contract";
import { encodeInt, encodeText } from "@bitspark/ontos-data";
import {
  atom, authorization, attributedClause, createSpacesVerifier, fact, path,
  type SpaceFactsBundle, type Value,
} from "@bitspark/thesmos";
import { authenticateArchon, signSpaceFacts } from "@bitspark/thesmos/archon";
import { prove } from "@bitspark/thesmos/client";

// Synthetic keys for a runnable offline example. No account or production key.
const seed = (n: number) => new Uint8Array(32).fill(n);
const principal = (n: number) => new Atom(getPublicKey(seed(n)));
export const root = principal(1), teamAsserter = principal(2), docsAsserter = principal(3);
export const alice = principal(4), bob = principal(5);
export const team = path("team"), space = path("team", "docs");
export const statement = fact("title", atom("doc7"), encodeText("Reconciled model"));
const time = encodeInt(1792137600n); // Evidence of assertion time, no built-in age check.
const supply = atom("supply_facts");

export function documentBundles(): readonly SpaceFactsBundle[] {
  return [
    signSpaceFacts({ supplier: root, space: path(), assertedAt: time, clauses: [
      attributedClause(root, path(), authorization(teamAsserter, supply, team)),
      attributedClause(root, path(), authorization(alice, statement, space)),
    ] }, seed(1)),
    signSpaceFacts({ supplier: teamAsserter, space: team, assertedAt: time, clauses: [
      attributedClause(teamAsserter, team, authorization(docsAsserter, supply, space)),
    ] }, seed(2)),
    signSpaceFacts({ supplier: docsAsserter, space, assertedAt: time, clauses: [
      attributedClause(alice, space, authorization(bob, statement, space)),
    ] }, seed(3)),
  ];
}

export class DocumentService {
  readonly documents = new Map([["doc7", "Original title"]]);
  private readonly verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });

  // authenticatedActor comes from the receiver's authentication integration.
  // The receiver chooses placement and constructs the query from the real request.
  rename(authenticatedActor: Value, id: string, title: string, proof: Uint8Array) {
    const decision = this.verifier.verify({
      query: { actor: authenticatedActor, space, statement: fact("title", atom(id), encodeText(title)) }, proof,
    });
    if (decision.permitted) this.documents.set(id, title);
    return decision;
  }
}

export async function runDocumentExample() {
  const query = { actor: bob, space, statement };
  const proof = await prove({ root, query, bundles: documentBundles() });
  const service = new DocumentService();
  assert.equal(service.rename(bob, "doc7", "Reconciled model", proof).permitted, true);
  assert.equal(service.rename(bob, "doc7", "A different title", proof).permitted, false);
  assert.equal(service.rename(principal(6), "doc7", "Reconciled model", proof).permitted, false);
  assert.equal(service.documents.get("doc7"), "Reconciled model");
  return { query, proof, service };
}

if (process.argv[1]?.endsWith("document-service.js")) {
  const { proof } = await runDocumentExample();
  console.log(`Document: signed root → team → docs chain; rename allowed, changed requests rejected (${proof.length} proof bytes).`);
}
