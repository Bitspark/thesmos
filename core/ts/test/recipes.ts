import {
  Atom, BuiltinNode, ClauseId, Derivation, GroundLiteral, LeafNode, RuleNode,
  type Clause, type Node, type Value,
} from "@bitspark/logos-contract";
import { lawDigest, layerDigest, loadLaw } from "../src/data.js";
import { atom, fact, inputLiteral, suppliedClause, list, listItems, substitution } from "../src/encoding.js";
import { decodeSpaceFacts } from "../src/bundles.js";
import { encodeProof } from "../src/proof.js";
import type { SpaceFactsBundle } from "../src/types.js";

export type ClientBindings = Readonly<Record<string, Value>>;

/** Explicit client proof recipes. No search or proof construction runs in the service. */
export class ProofBuilder {
  readonly nodes: Node[] = [];
  readonly bundles: SpaceFactsBundle[] = [];
  private readonly law = loadLaw();

  premise(claim: Value): number { return this.nodes.push(new LeafNode(inputLiteral(claim))) - 1; }
  anchor(root: Value): number { return this.premise(fact("root", root)); }
  private step(id: string, clause: Clause, bindings: ClientBindings, premises: readonly number[]): number {
    const subst = substitution(bindings);
    const claim = clause.head.substitute(subst).asGround();
    if (!claim) throw new Error("Bindings must ground the clause head");
    return this.nodes.push(new RuleNode(claim, ClauseId.of(id), subst, premises)) - 1;
  }
  apply(id: string, bindings: ClientBindings, premises: readonly number[]): number {
    const clause = this.law.clause(ClauseId.of(id));
    if (!clause) throw new Error("Unknown law clause " + id);
    return this.step(id, clause, bindings, premises);
  }
  prefix(prefix: Value, target: Value): number {
    const p = listItems(prefix), t = listItems(target);
    if (!p.length) return this.apply("prefix-empty", { T: target }, []);
    if (!t[0]?.equals(p[0]!)) throw new Error("Not a path prefix");
    const tail = this.prefix(list(p.slice(1)), list(t.slice(1)));
    return this.apply("prefix-step", { H: p[0]!, P: list(p.slice(1)), T: list(t.slice(1)) }, [tail]);
  }
  builtin(predicate: string, args: readonly Value[]): number {
    return this.nodes.push(new BuiltinNode(GroundLiteral.of(predicate, args))) - 1;
  }
  underlying(f: Value, space: Value): number {
    if (f instanceof Atom) return this.apply("underlying-atom", { F: f, S: space }, [this.builtin("atom", [f])]);
    const [name, ...args] = f.items();
    if (!(name instanceof Atom)) throw new TypeError("Statement must be a labeled Logos compound");
    if (name.equals(atom("authorized"))) {
      if (args.length === 3) {
        const [j, g, u] = args;
        const prior = this.underlying(g!, u!);
        const result = this.nodes[prior]!.conclusion.args;
        return this.apply("underlying-grant", { J: j!, G: g!, U: u!, S: space, F: result[2]!, T: result[3]! }, [prior]);
      }
      if (args.length < 3) {
        return this.apply("underlying-" + ["zero", "one", "two"][args.length],
          { S: space, ...Object.fromEntries(args.map((arg, i) => [["A", "B"][i]!, arg])) }, []);
      }
      const univ = this.builtin("=..", [f, list(f.items())]);
      return this.apply("underlying-many", { F: f, S: space, A: args[0]!, B: args[1]!, C: args[2]!, D: args[3]!, Rest: list(args.slice(4)) }, [univ]);
    }
    const univ = this.builtin("=..", [f, list(f.items())]);
    const different = this.builtin("\\==", [name, atom("authorized")]);
    return this.apply("underlying-other", { F: f, S: space, P: name, Args: list(args) }, [univ, different]);
  }
  bundle(output: SpaceFactsBundle): number { return this.bundles.push(output) - 1; }
  assert(bundle: number, index: number, bindings: ClientBindings, premises: readonly number[]): number {
    const evidence = this.bundles[bundle];
    if (!evidence) throw new Error("Unknown bundle");
    const output = decodeSpaceFacts(evidence.payload), assertion = output.clauses[index];
    if (!assertion) throw new Error("Unknown bundled clause");
    if (premises.length !== assertion.body.length + 2) throw new Error("Expected body, conclusion-authority and supplier-authority proofs");
    return this.step(`bundle/${bundle}/${index}`, suppliedClause(assertion, output.supplier, output.space), bindings, premises);
  }
  finish(conclusion: number): Uint8Array {
    return encodeProof({ law: lawDigest, layer: layerDigest, bundles: this.bundles, derivation: new Derivation(this.nodes, conclusion) });
  }
}
