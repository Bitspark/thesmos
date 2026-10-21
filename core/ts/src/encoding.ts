import {
  Atom, Clause, Goal, GroundLiteral, Term, TermAtom, TermTuple,
  Symbol, Tuple, wellFormedUtf16, type Subst, type Value,
} from "@bitspark/logos-contract";
import { assertionTemplate, spaceAsserterTemplate } from "./data.js";

/** A Logos symbol, not a text embedding. Text payloads use ontos-data encodeText. */
export function atom(name: string): Atom {
  if (!wellFormedUtf16(name)) throw new TypeError("Symbol must be valid Unicode");
  return new Atom(new TextEncoder().encode(name));
}
export const fact = (name: string, ...args: Value[]): Value => new Tuple([atom(name), ...args]);
/** Logos's [Head|Tail] notation. Distinct from ontos-data's flat list embedding. */
export function list(items: readonly Value[]): Value {
  let out: Value = atom("[]");
  for (let i = items.length - 1; i >= 0; i--) out = fact(".", items[i]!, out);
  return out;
}
export const path = (...segments: string[]): Value => list(segments.map(atom));
export function listItems(value: Value): Value[] {
  const result: Value[] = [];
  while (!value.equals(atom("[]"))) {
    if (!(value instanceof Tuple) || value.length !== 3 || !value.at(0)!.equals(atom("."))) throw new TypeError("Expected a proper Logos list");
    result.push(value.at(1)!);
    value = value.at(2)!;
  }
  return result;
}
export const authorization = (actor: Value, statement: Value, space: Value): Value => fact("authorized", actor, statement, space);
export const literalValue = (literal: GroundLiteral): Value => new Tuple([new Atom(literal.pred.bytes()), ...literal.args]);
export function inputLiteral(value: Value): GroundLiteral {
  if (value instanceof Atom) return GroundLiteral.of(Symbol.of(value.bytes()), []);
  const head = value.at(0);
  if (!(head instanceof Atom)) throw new TypeError("Expected a labeled Logos compound");
  return GroundLiteral.of(Symbol.of(head.bytes()), value.items().slice(1));
}
export function substitution(bindings: Readonly<Record<string, Value>>): Subst {
  return new Map(Object.entries(bindings).map(([name, value]) => [name, Term.fromValue(value)]));
}
function goalTerm(goal: Goal): Term {
  return new TermTuple([new TermAtom(goal.pred.bytes()), ...goal.args]);
}
/** One native attributed input form; a fact is a clause with an empty body. */
export function attributedClause(author: Value, space: Value, input: Value | Clause): Clause {
  const head = input instanceof Clause ? goalTerm(input.head) : Term.fromValue(input);
  return new Clause(Goal.of("counts", [Term.fromValue(author), Term.fromValue(space), head]),
    input instanceof Clause ? input.body : []);
}
/** Specialize rule 5 for an actual supplied clause, preserving its native variables. */
export function executableClause(assertion: Clause): Clause {
  if (!assertion.head.pred.equals(Symbol.of("counts")) || assertion.head.args.length !== 3) {
    throw new TypeError("Expected an attributed counts/3 clause");
  }
  const [author, space, head] = assertion.head.args;
  if (!Term.eraseGround(author!) || !Term.eraseGround(space!)) throw new TypeError("Author and space must be ground");
  listItems(Term.eraseGround(space!)!);
  for (const premise of assertion.body) {
    if (!premise.isPos() || premise.lit.args.length !== 3 ||
        !["authorized", "counts"].some(name => premise.lit.pred.equals(Symbol.of(name)))) {
      throw new TypeError("Authored bodies must use positive authorized/3 or counts/3 premises");
    }
  }
  const template = assertionTemplate();
  const bindings: Subst = new Map([
    ["A", author!], ["S", space!], ["H", head!],
  ]);
  // Native substitution is one pass: variables inside the authored head keep
  // their identity, even when named A, S or H like the law's placeholders.
  return new Clause(template.head.substitute(bindings), [
    ...assertion.body, ...template.body.map(premise => premise.substitute(bindings)),
  ]);
}

/** Syntax only: this establishes neither authentic authorship nor authority. */
export function inspectAttributedClause(assertion: Clause): { author: Value; space: Value } {
  executableClause(assertion);
  return {
    author: Term.eraseGround(assertion.head.args[0]!)!,
    space: Term.eraseGround(assertion.head.args[1]!)!,
  };
}

/** Translate only a clause from an authenticated output at its exact placement. */
export function suppliedClause(assertion: Clause, supplier: Value, placement: Value): Clause {
  executableClause(assertion); // Preserve the core's syntax and positive-body checks.
  const [author, space, head] = assertion.head.args;
  if (!Term.eraseGround(space!)!.equals(placement)) throw new TypeError("Clause placement differs from its bundle space");
  const bindings: Subst = new Map([
    ["A", author!], ["P", space!], ["H", head!], ["S", Term.fromValue(supplier)],
  ]);
  const template = spaceAsserterTemplate();
  return new Clause(template.head.substitute(bindings), [
    ...assertion.body, ...template.body.map(premise => premise.substitute(bindings)),
  ]);
}
