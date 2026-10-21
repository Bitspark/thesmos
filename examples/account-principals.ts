import { strict as assert } from "node:assert";
import { getPublicKey } from "@bitspark/archon";
import { Atom, BodyLit, Clause, Goal, Term } from "@bitspark/logos-contract";
import { encodeInt, encodeText } from "@bitspark/ontos-data";
import {
  atom, authorization, attributedClause, createSpacesVerifier, fact, path,
  type SpaceFactsBundle, type Value,
} from "@bitspark/thesmos";
import { authenticateArchon, signSpaceFacts } from "@bitspark/thesmos/archon";
import { prove } from "@bitspark/thesmos/client";
import { issuerSubjectPrincipal } from "@bitspark/thesmos/identity";

// Synthetic service keys only. The three people have no signing keys.
const seed = (n: number) => new Uint8Array(32).fill(n);
const key = (n: number) => new Atom(getPublicKey(seed(n)));
export const root = key(21), grantor = key(22), accounts = key(23), observer = key(24);
export const issuer = "https://accounts.example";
export const alice = issuerSubjectPrincipal(issuer, "alice");
export const bob = issuerSubjectPrincipal(issuer, "bob");
export const carol = issuerSubjectPrincipal(issuer, "carol");
export const team = path("team");
export const operations = [fact("title", encodeText("Reconciled model")), fact("temperature", encodeInt(21n))];
export const spaces = [path("team", "documents", "doc7"), path("team", "devices", "device7")];
const supply = atom("supply_facts"), time = encodeInt(1792540800n);

// authorized(Person,Operation,[team]) :- counts(observer,[team],eligible(Person)).
// Bob can confer only a conclusion for which the existing law proves his authority.
export const conditionalGrant = new Clause(
  Goal.of("authorized", [Term.var("Person"), Term.var("Operation"), Term.fromValue(team)]),
  [BodyLit.pos(Goal.of("counts", [Term.fromValue(observer), Term.fromValue(team),
    Term.tuple([Term.fromValue(atom("eligible")), Term.var("Person")])]))],
);

export interface AccountEvidenceOptions {
  readonly omit?: "supplier" | "alice" | "observation";
  readonly alternative?: boolean;
  readonly aliceAuthor?: Value;
}

export function accountBundles(options: AccountEvidenceOptions = {}): readonly SpaceFactsBundle[] {
  const at = (author: Value, input: Value | Clause) => attributedClause(author, team, input);
  return [
    signSpaceFacts({ supplier: root, space: path(), assertedAt: time, clauses: [
      attributedClause(root, path(), authorization(grantor, supply, team)),
      ...operations.map(op => attributedClause(root, path(), authorization(grantor, op, team))),
      attributedClause(root, path(), authorization(observer, supply, team)),
      attributedClause(root, path(), authorization(observer, fact("eligible", carol), team)),
    ] }, seed(21)),
    signSpaceFacts({ supplier: grantor, space: team, assertedAt: time, clauses:
      options.omit === "supplier" ? [] : [at(grantor, authorization(accounts, supply, team))],
    }, seed(22)),
    signSpaceFacts({ supplier: accounts, space: team, assertedAt: time, clauses: [
      ...(options.omit === "alice" ? [] : operations.map(op => at(grantor, authorization(alice, op, team)))),
      ...operations.map(op => at(options.aliceAuthor ?? alice, authorization(bob, op, team))),
      at(bob, conditionalGrant),
      ...(options.alternative ? operations.map(op => at(grantor, authorization(carol, op, team))) : []),
    ] }, seed(23)),
    signSpaceFacts({ supplier: observer, space: team, assertedAt: time, clauses:
      options.omit === "observation" ? [] : [at(observer, fact("eligible", carol))],
    }, seed(24)),
  ];
}

export async function runAccountExample() {
  const verifier = createSpacesVerifier({ root, authenticate: authenticateArchon });
  const proofs: Uint8Array[] = [];
  for (let i = 0; i < operations.length; i++) {
    const query = { actor: carol, statement: operations[i]!, space: spaces[i]! };
    const proof = await prove({ root, query, bundles: accountBundles() });
    assert.equal(verifier.verify({ query, proof }).permitted, true);
    assert.equal(verifier.verify({ query: { ...query, actor: issuerSubjectPrincipal("https://other.example", "carol") }, proof }).permitted, false);
    proofs.push(proof);
  }
  return proofs;
}

if (process.argv[1]?.endsWith("account-principals.js")) {
  const proofs = await runAccountExample();
  console.log(`Accounts: grantor → Alice → Bob → Carol; separate supplier and conditional-observation proofs; two vocabularies (${proofs.map(p => p.length).join(", ")} bytes).`);
}
