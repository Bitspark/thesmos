import {
  AlwaysAdmit, ClauseId, Evidence, NodeMeta, PredicateSet, TermTheory, type CheckProfile, type Value,
} from "@bitspark/logos-contract";
import {
  Bindings, ComponentBinding, Digest, DoorReplyError, Multiplicity, PreparedSessionError, Program, Session, WasmPreparedFactory, deriveCheckProfileSpec,
  type CatalogSupportPolicy, type FragmentTemplate, type PreparedAdmission, type RunLimits,
  type KernelOutcome, type PreparedQuery, type PreparedViewFactory,
  type PreparedViewLease, type RetainedPreparedWitness,
} from "@bitspark/logos-kernel";
import { createHash } from "node:crypto";
import { encode } from "@bitspark/ontos-codec";
import { authorization, fact, inputLiteral } from "./encoding.js";
import { checkLimits } from "./proof.js";
import { protocol } from "./data.js";
import { instantiateSpacesObservations } from "./runtime-fragments.js";
import {
  exportSpacesProof, prepareSpacesOverlay, prepareSpacesProgram,
  type CarryingBudget, type PreparationBudget, type SpacesExport, type SpacesProgram,
} from "./runtime-source.js";
export { instantiateSpacesObservations } from "./runtime-fragments.js";
import type { AuthenticateSpaceFacts, Query, SpaceFactsBundle } from "./types.js";

export {
  exportSpacesProof, PreparationRefused, prepareSpacesOverlay, prepareSpacesProgram, SpacesProgram,
  type CarryingBudget, type PreparationBudget, type SpacesExport,
} from "./runtime-source.js";

export type SpacesRuntimeDecision =
  | { readonly kind: "permitted"; readonly snapshot: string; readonly witness: SpacesWitness; readonly proof?: Uint8Array; readonly outcome: KernelOutcome }
  | { readonly kind: "forbidden"; readonly snapshot: string; readonly outcome: KernelOutcome }
  | { readonly kind: "unsupported"; readonly detail: string; readonly outcome?: KernelOutcome; readonly refusal?: DoorReplyError | PreparedSessionError };

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** The witness retains exact source bytes independently of requests and publications. */
export class SpacesWitness {
  constructor(
    readonly snapshot: string,
    private readonly retained: RetainedPreparedWitness,
    private readonly root: Value,
    private readonly query: Query,
    private readonly programs: readonly SpacesProgram[],
    private readonly authenticate: AuthenticateSpaceFacts,
  ) {}

  async export(budget?: CarryingBudget): Promise<SpacesExport> {
    const candidate = await this.retained.export();
    if (!candidate.derivation) return { kind: "unavailable", reason: "invalid-witness", detail: "Retained support exported no derivation" };
    return exportSpacesProof({ root: this.root, query: this.query, programs: this.programs,
      derivation: candidate.derivation, authenticate: this.authenticate, budget });
  }
  close(): void { this.retained.close(); }
}

export interface SpacesRuntimeConfig {
  readonly root: Value;
  readonly bundles: readonly SpaceFactsBundle[];
  readonly authenticate: AuthenticateSpaceFacts;
  readonly preparationBudget: PreparationBudget;
  readonly memoryLimitPages?: number;
  /** A finite declared family of guarded request clauses, with ground parameters. */
  readonly observationTemplates?: readonly FragmentTemplate[];
  readonly limits?: RunLimits;
}

export interface SpacesRequestOptions {
  readonly query: Query;
  readonly observations: readonly SpaceFactsBundle[];
  readonly portable?: "optional" | "required";
  readonly carryingBudget?: CarryingBudget;
  readonly signal?: AbortSignal;
}

export interface SpacesPreparedRequest {
  /** Admission includes native constructive demand work; it is not a free syntax check. */
  readonly admission: PreparedAdmission;
  run(): Promise<SpacesRuntimeDecision>;
  close(): void;
}

/** A thin source and evidence adapter; all evaluation and admission belong to Logos. */
export class SpacesRuntime {
  #base: SpacesProgram;
  #lease: PreparedViewLease;
  #closed = false;
  #replacing = false;
  private constructor(
    private readonly config: SpacesRuntimeConfig,
    private readonly owner: Session,
    private readonly factory: PreparedViewFactory,
    private readonly profile: CheckProfile<undefined>,
    base: SpacesProgram,
    lease: PreparedViewLease,
  ) { this.#base = base; this.#lease = lease; }

  static async open(config: SpacesRuntimeConfig): Promise<SpacesRuntime> {
    const base = prepareSpacesProgram({ bundles: config.bundles, authenticate: config.authenticate, budget: config.preparationBudget });
    const anchor = inputLiteral(fact("root", config.root));
    const profile: CheckProfile<undefined> = {
      theory: new TermTheory(),
      leaves: { extensional: () => PredicateSet.from(["root"]),
        verify: claim => claim.equals(anchor) ? { kind: "admit" } : { kind: "reject", code: "unaccepted_premise" } },
      admit: new AlwaysAdmit<undefined>(), limits: { ...checkLimits },
    };
    const captured = { ...config, bundles: base.selectedBundles(), preparationBudget: Object.freeze({ ...config.preparationBudget }),
      observationTemplates: Object.freeze((config.observationTemplates ?? []).map(t => Object.freeze({ ...t, parameters: Object.freeze([...t.parameters]) }))),
      limits: config.limits && Object.freeze({ ...config.limits }) };
    const factory = WasmPreparedFactory.create({ checkProfile: profile, ctx: undefined, memoryLimitPages: config.memoryLimitPages,
      templates: captured.observationTemplates, limits: captured.limits });
    const owner = Session.open(Program.fromLookup(base.nativeProgram()), Bindings.empty().bind("root/1", [anchor]), Multiplicity.Set);
    try { return new SpacesRuntime(captured, owner, factory, profile, base, await owner.prepare(factory)); }
    catch (error) { owner.close(); throw error; }
  }

  get baseIdentity(): string { return this.#base.identity; }

  /** Replacement is prepared before publication. Existing requests keep their old lease. */
  async replace(bundles: readonly SpaceFactsBundle[]): Promise<void> {
    if (this.#closed || this.#replacing) throw new Error("Runtime is closed or a replacement is already being prepared");
    this.#replacing = true;
    try {
      const base = prepareSpacesProgram({ bundles, authenticate: this.config.authenticate, budget: this.config.preparationBudget });
      const anchor = inputLiteral(fact("root", this.config.root));
      const ticket = await this.owner.prepareReplacement(Program.fromLookup(base.nativeProgram()), Bindings.empty().bind("root/1", [anchor]), this.factory);
      try { this.owner.publish(ticket); } catch (error) { ticket.close(); throw error; }
      const lease = this.owner.pin(), previous = this.#lease;
      this.#base = base; this.#lease = lease;
      previous.close();
    } finally { this.#replacing = false; }
  }

  #portableSupport(programs: readonly SpacesProgram[], budget?: CarryingBudget): CatalogSupportPolicy {
    const groups = new Map<string, { id: string; encodedBytes: number; clauses: number }>();
    const rules = new Map<string, readonly string[]>();
    for (const program of programs) {
      for (const [id] of program.nativeProgram().entries()) rules.set(id, []);
      for (const source of program.sourceCosts()) {
        groups.set(source.group, { id: source.group, encodedBytes: source.encodedBytes, clauses: source.clauses });
        rules.set(source.clauseId, [source.group]);
      }
    }
    const cost = { maxGroups: protocol.limits.maxProofSteps,
      maxBytes: budget?.maxBytes ?? protocol.limits.maxProofBytes,
      maxClauses: budget?.maxClauses ?? protocol.limits.maxProofSteps, reservedEnvelopeBytes: 128 };
    const binding = deriveCheckProfileSpec(this.profile);
    const digest = createHash("sha256").update(JSON.stringify({ programs: programs.map(p => p.identity), cost,
      root: hex(encode(this.config.root)), profile: binding.digest().toHex() })).digest();
    return { kind: "portable", identity: ComponentBinding.of("thesmos/signed-source-catalog", "1", Digest.of(digest)),
      groups: [...groups.values()], budget: cost, entries: [
        ...[...rules].map(([id, sourceGroups]) => ({ source: { kind: "rule" as const, clauseId: ClauseId.of(id), meta: NodeMeta.none() }, groups: sourceGroups })),
        { source: { kind: "leaf", fact: inputLiteral(fact("root", this.config.root)), evidence: Evidence.none() }, groups: [] },
        { source: { kind: "builtin", binding: binding.theories[0]! }, groups: [] },
      ] };
  }

  async request(request: SpacesRequestOptions): Promise<SpacesPreparedRequest> {
    if (this.#closed) throw new Error("Runtime is closed");
    const base = this.#base, lease = this.#lease;
    const query = Object.freeze({ ...request.query }), carryingBudget = request.carryingBudget && Object.freeze({ ...request.carryingBudget });
    const required = request.portable === "required", signal = request.signal;
    const overlay = prepareSpacesOverlay({ bundles: request.observations, authenticate: this.config.authenticate, budget: this.config.preparationBudget });
    const execution: PreparedQuery = await lease.request({ goal: inputLiteral(authorization(query.actor, query.statement, query.space)).toGoal(),
      fragments: instantiateSpacesObservations(overlay, this.config.observationTemplates ?? []), limits: this.config.limits,
      support: required ? this.#portableSupport([base, overlay], carryingBudget) : { kind: "local" },
      evidence: required ? { policy: "generate", retention: "retain", verify: { kind: "every" } }
        : { policy: "none", retention: "discard", verify: { kind: "none" } }, witnessCapture: "retain" });
    return { admission: execution.admission(), close: () => execution.close(), run: async () => {
      const result = await execution.run(signal), snapshot = hex(result.snapshot.bytes);
      if (result.completion.kind === "incomplete") return { kind: "unsupported", detail: result.completion.reason, outcome: result.outcome };
      if (result.completion.kind === "absent") return { kind: "forbidden", snapshot, outcome: result.outcome };
      const retained = result.witnesses[0];
      if (!retained) return { kind: "unsupported", detail: "The provider returned no retained support", outcome: result.outcome };
      for (const extra of result.witnesses.slice(1)) extra.close();
      const witness = new SpacesWitness(snapshot, retained, this.config.root, query, [base, overlay], this.config.authenticate);
      if (required) {
        const exported = await witness.export(carryingBudget);
        if (exported.kind !== "exported") { witness.close(); return { kind: "unsupported", detail: `${exported.reason}: ${exported.detail}`, outcome: result.outcome }; }
        return { kind: "permitted", snapshot, outcome: result.outcome, witness, proof: exported.proof };
      }
      return { kind: "permitted", snapshot, outcome: result.outcome, witness };
    } };
  }

  async decide(request: SpacesRequestOptions): Promise<SpacesRuntimeDecision> {
    let prepared: SpacesPreparedRequest | undefined;
    try { prepared = await this.request(request); return await prepared.run(); }
    catch (error) {
      if (error instanceof DoorReplyError || error instanceof PreparedSessionError)
        return { kind: "unsupported", detail: error.message, refusal: error };
      throw error;
    } finally { prepared?.close(); }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lease.close(); this.owner.close();
  }
}

export const createSpacesRuntime = (config: SpacesRuntimeConfig): Promise<SpacesRuntime> => SpacesRuntime.open(config);
