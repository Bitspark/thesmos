import { ClauseId, Term, type Clause, type Goal, type Subst } from "@bitspark/logos-contract";
import type { FragmentInstance, FragmentTemplate } from "@bitspark/logos-kernel";
import { PreparationRefused, type SpacesProgram } from "./runtime-source.js";

/** Match syntax only. Parameters are ground; logical variables retain identity. */
export function instantiateSpacesObservations(program: SpacesProgram, templates: readonly FragmentTemplate[]): FragmentInstance[] {
  const match = (actual: Clause, template: FragmentTemplate): Subst | undefined => {
    const parameters = new Set(template.parameters.map(parameter => parameter.asStr()));
    const bindings: Subst = new Map();
    const term = (pattern: Term, input: Term): boolean => {
      if (pattern.kind === "var" && parameters.has(pattern.id().asStr())) {
        if (Term.eraseGround(input) === undefined) return false;
        const name = pattern.id().asStr(), previous = bindings.get(name);
        if (previous !== undefined) return previous.equals(input);
        bindings.set(name, input); return true;
      }
      if (pattern.kind !== "tuple" || input.kind !== "tuple") return pattern.equals(input);
      return pattern.children().length === input.children().length && pattern.children().every((p, i) => term(p, input.children()[i]!));
    };
    const goal = (pattern: Goal, input: Goal): boolean => pattern.pred.equals(input.pred) &&
      pattern.args.length === input.args.length && pattern.args.every((p, i) => term(p, input.args[i]!));
    if (!goal(template.clause.head, actual.head) || template.clause.body.length !== actual.body.length) return;
    if (!template.clause.body.every((p, i) => p.isPos() && actual.body[i]!.isPos() && goal(p.lit, actual.body[i]!.lit))) return;
    if (bindings.size !== parameters.size) return;
    return bindings;
  };
  return program.nativeProgram().entries().map(([id, clause]) => {
    for (const template of templates) {
      const bindings = match(clause, template);
      if (bindings) return { template: template.name, clauseId: ClauseId.of(id), bindings };
    }
    throw new PreparationRefused("invalid-input", `No declared observation fragment matches ${id}`);
  });
}
