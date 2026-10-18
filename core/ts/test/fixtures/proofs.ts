import { Clause, Goal, Term, TermTuple, type Value } from "@bitspark/logos-contract";
import { encodeInt, encodeText } from "@bitspark/ontos-data";
import { atom, authorization, attributedClause, fact, path } from "../../src/index.js";
import { ProofBuilder, type ClientBindings } from "../recipes.js";
import { signExampleFacts } from "./authentication.js";

export const ROOT = atom("root_key");
export const EXAMPLE_TIME = encodeInt(1792015200n);
export const SUPPLY_FACTS = atom("supply_facts");
// These are example CLIENT recipes. The service receives only their encoded proofs.
export function rootAuthority(p: ProofBuilder, anchor: number, statement: Value, space: Value): number {
  return p.apply("root-authority", { R: ROOT, F: statement, S: space }, [anchor]);
}
export function countAssertion(p: ProofBuilder, author: Value, statement: Value, space: Value, authority: number): number {
  return rootSupplied(p, author, space, statement, {}, [authority]);
}
/** Core examples use root's retained supply authority, even in descendant spaces. */
export function rootSupplied(p: ProofBuilder, author: Value, space: Value, input: Value | Clause,
  bindings: ClientBindings, premises: readonly number[]): number {
  const bundle = p.bundle(signExampleFacts({ supplier: ROOT, space, assertedAt: EXAMPLE_TIME,
    clauses: [attributedClause(author, space, input)] }));
  const supply = rootAuthority(p, p.anchor(ROOT), SUPPLY_FACTS, space);
  return p.assert(bundle, 0, bindings, [...premises, supply]);
}
export function rootCounts(p: ProofBuilder, anchor: number, statement: Value, space: Value): number {
  return countAssertion(p, ROOT, statement, space, rootAuthority(p, anchor, statement, space));
}
export function confer(p: ProofBuilder, counted: number, author: Value, placement: Value,
  recipient: Value, statement: Value, target: Value): number {
  const underlying = p.underlying(statement, target);
  const within = p.prefix(placement, target);
  return p.apply("conferral", { A: author, P: placement, I: recipient, G: statement, U: target, F: statement, T: target }, [counted, underlying, within]);
}
export function rootGrant(p: ProofBuilder, anchor: number, recipient: Value, statement: Value, target: Value): number {
  const counted = rootCounts(p, anchor, authorization(recipient, statement, target), path());
  return confer(p, counted, ROOT, path(), recipient, statement, target);
}
export function delegatedGrant(p: ProofBuilder, held: number, author: Value, recipient: Value,
  statement: Value, target: Value, placement: Value): number {
  const grant = authorization(recipient, statement, target);
  const rightToGrant = p.apply("may-confer", { I: author, J: recipient, F: statement, T: target, S: placement }, [held]);
  const counted = countAssertion(p, author, grant, placement, rightToGrant);
  return confer(p, counted, author, placement, recipient, statement, target);
}
export function documentProof() {
  const p = new ProofBuilder();
  const statement = fact("title", atom("doc7"), encodeText("Reconciled model"));
  const team = path("team"), space = path("team", "docs");
  const teamAsserter = atom("team_asserter"), docsAsserter = atom("docs_asserter");
  const aliceId = atom("alice"), bobId = atom("bob");
  const teamAppointment = authorization(teamAsserter, SUPPLY_FACTS, team);
  const aliceGrant = authorization(aliceId, statement, space);
  const docsAppointment = authorization(docsAsserter, SUPPLY_FACTS, space);
  const bobGrant = authorization(bobId, statement, space);

  // Each signer publishes its own output; the caller packages these with one proof.
  const rootBundle = p.bundle(signExampleFacts({ supplier: ROOT, space: path(), assertedAt: EXAMPLE_TIME,
    clauses: [attributedClause(ROOT, path(), teamAppointment), attributedClause(ROOT, path(), aliceGrant)] }));
  const teamBundle = p.bundle(signExampleFacts({ supplier: teamAsserter, space: team, assertedAt: EXAMPLE_TIME,
    clauses: [attributedClause(teamAsserter, team, docsAppointment)] }));
  const docsBundle = p.bundle(signExampleFacts({ supplier: docsAsserter, space, assertedAt: EXAMPLE_TIME,
    clauses: [attributedClause(aliceId, space, bobGrant)] }));

  const anchor = p.anchor(ROOT), rootSupply = rootAuthority(p, anchor, SUPPLY_FACTS, path());
  const teamCount = p.assert(rootBundle, 0, {}, [rootAuthority(p, anchor, teamAppointment, path()), rootSupply]);
  const teamSupply = confer(p, teamCount, ROOT, path(), teamAsserter, SUPPLY_FACTS, team);
  const aliceCount = p.assert(rootBundle, 1, {}, [rootAuthority(p, anchor, aliceGrant, path()), rootSupply]);
  const alice = confer(p, aliceCount, ROOT, path(), aliceId, statement, space);
  const inheritedSupply = p.apply("descendant-authority", { I: teamAsserter, F: SUPPLY_FACTS, S: team, T: space }, [teamSupply, p.prefix(team, space)]);
  const mayAppoint = p.apply("may-confer", { I: teamAsserter, J: docsAsserter, F: SUPPLY_FACTS, T: space, S: team }, [inheritedSupply]);
  const docsCount = p.assert(teamBundle, 0, {}, [mayAppoint, teamSupply]);
  const docsSupply = confer(p, docsCount, teamAsserter, team, docsAsserter, SUPPLY_FACTS, space);
  const mayGrant = p.apply("may-confer", { I: aliceId, J: bobId, F: statement, T: space, S: space }, [alice]);
  const bobCount = p.assert(docsBundle, 0, {}, [mayGrant, docsSupply]);
  const bob = confer(p, bobCount, aliceId, space, bobId, statement, space);
  return { proof: p.finish(bob), aliceProof: p.finish(alice), query: { actor: bobId, space, statement },
    rootBundle, teamBundle, docsBundle, teamSupply, docsSupply, bobCount };
}
export function deviceProof() {
  const p = new ProofBuilder();
  const statement = fact("temperature", atom("device7"), encodeInt(21n));
  const parent = path("lab"), space = path("lab", "bench");
  const held = rootGrant(p, p.anchor(ROOT), atom("technician"), statement, parent);
  const inherited = p.apply("descendant-authority", { I: atom("technician"), F: statement, S: parent, T: space }, [held, p.prefix(parent, space)]);
  const direct = new ProofBuilder();
  const directRoot = rootAuthority(direct, direct.anchor(ROOT), statement, space);
  return { proof: p.finish(inherited), rootProof: direct.finish(directRoot), query: { actor: atom("technician"), space, statement } };
}
export function releaseProof() {
  const p = new ProofBuilder();
  const anchor = p.anchor(ROOT), space = path("project");
  const maintainer = atom("maintainer"), carol = atom("carol"), reviewer = atom("reviewer");
  const statement = fact("deployed", atom("widget"), atom("r1"));
  const approval = fact("approved", atom("widget"), atom("r1"));
  const v = Term.fromValue, release = Term.var("Release");
  // Native Clause equivalent to:
  // authorized(carol,deployed(widget,Release),[project]) :-
  //   counts(reviewer,[project],approved(widget,Release)).
  const policy = new Clause(Goal.of("authorized", [v(carol), new TermTuple([v(atom("deployed")), v(atom("widget")), release]), v(space)]),
    [Goal.of("counts", [v(reviewer), v(space), new TermTuple([v(atom("approved")), v(atom("widget")), release])])]);
  const held = rootGrant(p, anchor, maintainer, statement, space);
  const reviewerRight = rootGrant(p, anchor, reviewer, approval, space);
  const approved = countAssertion(p, reviewer, approval, space, reviewerRight);
  const conclusionRight = p.apply("may-confer", { I: maintainer, J: carol, F: statement, T: space, S: space }, [held]);
  const policyIndex = p.bundles.length;
  const policyStep = rootSupplied(p, maintainer, space, policy, { Release: atom("r1") }, [approved, conclusionRight]);
  const permission = confer(p, policyStep, maintainer, space, carol, statement, space);
  return { proof: p.finish(permission), query: { actor: carol, space, statement }, policyStep, policyIndex, conclusionRight, approved };
}
