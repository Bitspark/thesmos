// Deterministic structural reproduction of Bitspark/thesmos#28, from Accounts
// 90a3b8e385d8e791f4ce0693ac6a33a065acdf1b test/proof-stack.test.ts and its
// document-policy example. These are synthetic test values, never SDK policy.
// The original foundation used Date.now(); all timestamps here are fixed.
import { getPublicKey } from "@bitspark/archon";
import { Atom, BodyLit, Clause, Goal, Term, type Value } from "@bitspark/logos-contract";
import { encodeInt, encodeText } from "@bitspark/ontos-data";
import { atom, attributedClause, authorization, fact, path, type SpaceFactsBundle } from "../src/index.js";
import { signSpaceFacts } from "../src/archon.js";
import { issuerSubjectPrincipal } from "../src/identity.js";

const seed = (n: number) => new Uint8Array(32).fill(n);
const rootSeed = seed(101), issuerSeed = seed(102), serviceSeed = seed(103), supplierSeed = seed(104);
const principal = (key: Uint8Array) => new Atom(getPublicKey(key));
const root = principal(rootSeed), issuer = principal(issuerSeed), service = principal(serviceSeed), supplier = principal(supplierSeed);
const assertedAt = encodeInt(1793228400000n), scope = path("documents"), space = path("documents", "proof-capacity");
const value = Term.fromValue;
const tuple = (name: string, ...args: Term[]) => Term.tuple([value(atom(name)), ...args]);
const signed = (key: Uint8Array, placement: Value, clauses: Clause[]): SpaceFactsBundle =>
  signSpaceFacts({ supplier: principal(key), space: placement, assertedAt, clauses }, key);

function conditionalGrant(author: Value, recipient: Value, standing = false): Clause {
  const title = Term.var("Title");
  return attributedClause(author, space, new Clause(
    Goal.of("authorized", [value(recipient), tuple("rename", title), value(space)]), [
      BodyLit.pos(Goal.of("counts", [value(service), value(space), tuple("allowed_title", title)])),
      ...(standing ? [BodyLit.pos(Goal.of("counts", [value(service), value(space),
        value(fact("eligible", recipient))]))] : []),
    ]));
}

export function conditionalCapacityFixture(hops: number) {
  if (!Number.isSafeInteger(hops) || hops < 0) throw new RangeError("Fixture size must be a non-negative integer");
  const people = Array.from({ length: hops + 1 }, (_, index) =>
    issuerSubjectPrincipal("https://accounts.example", `person-${index}`));
  const title = Term.var("Title"), person = Term.var("Person");
  const statements = [value(atom("supply_facts")), value(atom("read_records")), tuple("rename", title),
    tuple("allowed_title", title), tuple("eligible", person)];
  const grant = (author: Value, placement: Value, recipient: Value, statement: Term) =>
    attributedClause(author, placement, new Clause(Goal.of("authorized", [value(recipient), statement, value(scope)]), []));
  const foundation = [
    signed(rootSeed, path(), statements.map(statement => grant(root, path(), issuer, statement))),
    signed(issuerSeed, scope, [...statements.map(statement => grant(issuer, scope, service, statement)),
      attributedClause(issuer, scope, authorization(supplier, atom("supply_facts"), scope))]),
    signed(serviceSeed, space, [conditionalGrant(service, people[0]!, true),
      ...["Draft", "Approved"].map(text => attributedClause(service, space, fact("allowed_title", encodeText(text))))]),
    signed(serviceSeed, space, [attributedClause(service, space, fact("eligible", people[0]!))]),
  ];
  const grants = people.slice(1).map((recipient, index) =>
    signed(supplierSeed, space, [conditionalGrant(people[index]!, recipient)]));
  return { root, query: { actor: people[hops]!, space, statement: fact("rename", encodeText("Approved")) },
    bundles: [...foundation, ...grants] };
}
