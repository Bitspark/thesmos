import {
  AlwaysAdmit, ClauseId, Evidence, NodeMeta, PredicateSet, TermTheory, clauseFromValue, clauseValue, type CheckProfile, type Clause, type Value,
} from "@bitspark/logos-contract";
import {
  Bindings, ComponentBinding, Digest, DoorReplyError, Multiplicity, PreparedSessionError, Program, Session, WasmPreparedFactory, deriveCheckProfileSpec,
  type CatalogSupportPolicy, type FragmentTemplate, type PreparedAdmission, type RunLimits,
  type PreparedQueryDiagnostics, type PreparedViewDiagnostics, type PreparedWitnessDiagnostics,
  type KernelOutcome, type PreparedQuery, type PreparedViewFactory,
  type PreparedViewLease, type RetainedPreparedWitness,
} from "@bitspark/logos-kernel";
import { createHash } from "node:crypto";
import { decode, encode } from "@bitspark/ontos-codec";
import { authorization, fact, inputLiteral } from "./encoding.js";
import { checkLimits } from "./proof.js";
import { protocol } from "./data.js";
import { instantiateSpacesObservations } from "./runtime-fragments.js";
import {
  exportSpacesProof, portableEnvelopeReserve, prepareSpacesOverlay, prepareSpacesProgram,
  type CarryingBudget, type PreparationBudget, type SpacesExport, type SpacesProgram,
} from "./runtime-source.js";
export { instantiateSpacesObservations } from "./runtime-fragments.js";
import type { AuthenticateSpaceFacts, Query, SpaceFactsBundle } from "./types.js";
import { beginRuntimeDiagnostic, diagnosticFactory, runtimeCheckpoint, runtimeFailure, runtimePhase } from "./runtime-diagnostic.js";

export {
  exportSpacesProof, portableEnvelopeReserve, PreparationRefused, prepareSpacesOverlay, prepareSpacesProgram, SpacesProgram,
  type CarryingBudget, type PreparationBudget, type SpacesExport,
} from "./runtime-source.js";

export type SpacesRuntimeDecision =
  | { readonly kind: "permitted"; readonly snapshot: string; readonly witness: SpacesWitness; readonly proof?: Uint8Array; readonly outcome: KernelOutcome }
  | { readonly kind: "forbidden"; readonly snapshot: string; readonly outcome: KernelOutcome }
  | { readonly kind: "unsupported"; readonly detail: string; readonly outcome?: KernelOutcome; readonly refusal?: DoorReplyError | PreparedSessionError };

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const copyValue = (value: Value): Value => decode(encode(value));
const copyClause = (clause: Clause): Clause => {
  const copy = clauseFromValue(decode(encode(clauseValue(clause))));
  if (!copy) throw new TypeError("Invalid observation template clause");
  return copy;
};

/** The witness retains exact source bytes independently of requests and publications. */
export class SpacesWitness {
  #state: { retained: RetainedPreparedWitness; root: Value; query: Query;
    programs: readonly SpacesProgram[]; authenticate: AuthenticateSpaceFacts } | undefined;
  constructor(
    readonly snapshot: string,
    retained: RetainedPreparedWitness,
    root: Value,
    query: Query,
    programs: readonly SpacesProgram[],
    authenticate: AuthenticateSpaceFacts,
  ) { this.#state = { retained, root, query, programs, authenticate }; }

  #live() {
    if (!this.#state) throw new PreparedSessionError("witness_closed");
    return this.#state;
  }
  diagnostics(): PreparedWitnessDiagnostics { return this.#live().retained.diagnostics(); }
  async export(budget?: CarryingBudget): Promise<SpacesExport> {
    const state = this.#live();
    const capturedBudget = budget && Object.freeze({ ...budget });
    const candidate = await state.retained.export();
    if (!candidate.derivation) return { kind: "unavailable", reason: "invalid-witness", detail: "Retained support exported no derivation" };
    return exportSpacesProof({ root: state.root, query: state.query, programs: state.programs,
      derivation: candidate.derivation, authenticate: state.authenticate, budget: capturedBudget });
  }
  close(): void {
    const state = this.#state;
    this.#state = undefined;
    state?.retained.close();
  }
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
  diagnostics(): PreparedQueryDiagnostics;
  run(): Promise<SpacesRuntimeDecision>;
  close(): void;
}

interface RequestState {
  readonly execution: PreparedQuery;
  readonly admission: PreparedAdmission;
  readonly root: Value;
  readonly query: Query;
  readonly programs: readonly SpacesProgram[];
  readonly authenticate: AuthenticateSpaceFacts;
  readonly required: boolean;
  readonly carryingBudget?: CarryingBudget;
  readonly signal?: AbortSignal;
}

/** Clear host context too: retaining a closed request must not retain its old base. */
class PreparedSpacesRequest implements SpacesPreparedRequest {
  #state: RequestState | undefined;
  constructor(state: RequestState) { this.#state = state; }
  #live(): RequestState {
    if (!this.#state) throw new PreparedSessionError("request_closed");
    return this.#state;
  }
  get admission(): PreparedAdmission { return this.#live().admission; }
  diagnostics(): PreparedQueryDiagnostics { return this.#live().execution.diagnostics(); }
  async run(): Promise<SpacesRuntimeDecision> {
    // An operation that already started owns its context until it settles.
    const state = this.#live();
    const result = await state.execution.run(state.signal), snapshot = hex(result.snapshot.bytes);
    if (result.completion.kind === "incomplete") return { kind: "unsupported", detail: result.completion.reason, outcome: result.outcome };
    if (result.completion.kind === "absent") return { kind: "forbidden", snapshot, outcome: result.outcome };
    const retained = result.witnesses[0];
    if (!retained) return { kind: "unsupported", detail: "The provider returned no retained support", outcome: result.outcome };
    for (const extra of result.witnesses.slice(1)) extra.close();
    const witness = new SpacesWitness(snapshot, retained, state.root, state.query, state.programs, state.authenticate);
    if (state.required) {
      let exported: SpacesExport;
      try { exported = await witness.export(state.carryingBudget); }
      catch (error) { witness.close(); throw error; }
      if (exported.kind !== "exported") { witness.close(); return { kind: "unsupported", detail: `${exported.reason}: ${exported.detail}`, outcome: result.outcome }; }
      return { kind: "permitted", snapshot, outcome: result.outcome, witness, proof: exported.proof };
    }
    return { kind: "permitted", snapshot, outcome: result.outcome, witness };
  }
  close(): void {
    const state = this.#state;
    this.#state = undefined;
    state?.execution.close();
  }
}

interface RuntimeState {
  readonly config: Omit<SpacesRuntimeConfig, "bundles">;
  readonly owner: Session;
  readonly factory: PreparedViewFactory;
  readonly profile: CheckProfile<undefined>;
  base: SpacesProgram;
  lease: PreparedViewLease;
}

/** A thin source and evidence adapter; all evaluation and admission belong to Logos. */
export class SpacesRuntime {
  #state: RuntimeState | undefined;
  #baseIdentity: string;
  #replacing = false;
  private constructor(state: RuntimeState) { this.#state = state; this.#baseIdentity = state.base.identity; }
  #live(): RuntimeState {
    if (!this.#state) throw new PreparedSessionError("runtime_closed");
    return this.#state;
  }

  static async open(config: SpacesRuntimeConfig): Promise<SpacesRuntime> {
    const diagnostic = beginRuntimeDiagnostic("create");
    runtimeCheckpoint(diagnostic, "config-capture", "start");
    config = { ...config, root: copyValue(config.root),
      preparationBudget: Object.freeze({ ...config.preparationBudget }),
      observationTemplates: (config.observationTemplates ?? []).map(template => ({ ...template,
        clause: copyClause(template.clause), parameters: [...template.parameters] })) };
    runtimeCheckpoint(diagnostic, "config-capture", "complete");
    const base = runtimePhase(diagnostic, "source-capture", () => prepareSpacesProgram({
      bundles: config.bundles, authenticate: config.authenticate, budget: config.preparationBudget }));
    const anchor = inputLiteral(fact("root", config.root));
    const profile: CheckProfile<undefined> = {
      theory: new TermTheory(),
      leaves: { extensional: () => PredicateSet.from(["root"]),
        verify: claim => claim.equals(anchor) ? { kind: "admit" } : { kind: "reject", code: "unaccepted_premise" } },
      admit: new AlwaysAdmit<undefined>(), limits: { ...checkLimits },
    };
    const captured: Omit<SpacesRuntimeConfig, "bundles"> = { root: config.root, authenticate: config.authenticate,
      memoryLimitPages: config.memoryLimitPages, preparationBudget: Object.freeze({ ...config.preparationBudget }),
      observationTemplates: Object.freeze((config.observationTemplates ?? []).map(t => Object.freeze({ ...t, parameters: Object.freeze([...t.parameters]) }))),
      limits: config.limits && Object.freeze({ ...config.limits }) };
    const factory = runtimePhase(diagnostic, "factory-create", () => WasmPreparedFactory.create({
      checkProfile: profile, ctx: undefined, memoryLimitPages: config.memoryLimitPages,
      templates: captured.observationTemplates, limits: captured.limits }));
    // The defensive decoded graph has the same operation lifetime as the former
    // inline Session.open argument; no diagnostic callback retains it afterwards.
    const owner = (() => {
      const program = runtimePhase(diagnostic, "native-program-decode", () => Program.fromLookup(base.nativeProgram()));
      return runtimePhase(diagnostic, "session-open", () => Session.open(program, Bindings.empty().bind("root/1", [anchor]), Multiplicity.Set));
    })();
    runtimeCheckpoint(diagnostic, "owner-prepare", "start");
    try {
      const lease = await owner.prepare(diagnosticFactory(diagnostic, factory));
      runtimeCheckpoint(diagnostic, "owner-prepare", "complete");
      runtimeCheckpoint(diagnostic, "create", "complete");
      return new SpacesRuntime({ config: captured, owner, factory, profile, base, lease });
    } catch (error) {
      runtimeFailure(diagnostic, "owner-prepare", error);
      owner.close(); throw error;
    }
  }

  get baseIdentity(): string { return this.#baseIdentity; }
  diagnostics(): PreparedViewDiagnostics { return this.#live().lease.diagnostics(); }

  /** Replacement is prepared before publication. Existing requests keep their old lease. */
  async replace(bundles: readonly SpaceFactsBundle[]): Promise<void> {
    const state = this.#live();
    if (this.#replacing) throw new PreparedSessionError("replacement_in_progress");
    this.#replacing = true;
    const diagnostic = beginRuntimeDiagnostic("replace");
    try {
      const base = runtimePhase(diagnostic, "replacement-source-capture", () => prepareSpacesProgram({
        bundles, authenticate: state.config.authenticate, budget: state.config.preparationBudget }));
      const anchor = inputLiteral(fact("root", state.config.root));
      const pending = (() => {
        const program = runtimePhase(diagnostic, "replacement-native-program-decode", () => Program.fromLookup(base.nativeProgram()));
        runtimeCheckpoint(diagnostic, "replacement-prepare", "start");
        return state.owner.prepareReplacement(program, Bindings.empty().bind("root/1", [anchor]), diagnosticFactory(diagnostic, state.factory));
      })();
      const ticket = await pending;
      runtimeCheckpoint(diagnostic, "replacement-prepare", "complete");
      try {
        if (this.#state !== state) throw new PreparedSessionError("runtime_closed");
        state.owner.publish(ticket);
      } catch (error) { ticket.close(); throw error; }
      const lease = state.owner.pin(), previous = state.lease;
      state.base = base; state.lease = lease; this.#baseIdentity = base.identity;
      previous.close();
      runtimeCheckpoint(diagnostic, "replace", "complete");
    } finally { this.#replacing = false; }
  }

  #portableSupport(state: RuntimeState, programs: readonly SpacesProgram[], budget?: CarryingBudget): CatalogSupportPolicy {
    for (const [bound, maximum] of [[budget?.maxBytes, protocol.limits.maxProofBytes],
      [budget?.maxClauses, protocol.limits.maxProofSteps], [budget?.maxSteps, protocol.limits.maxProofSteps]]) {
      if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0 || bound > maximum!))
        throw new TypeError("A carrying budget may tighten, but cannot enlarge, the portable limits");
    }
    const groups = new Map<string, { id: string; encodedBytes: number; clauses: number }>();
    const rules = new Map<string, readonly string[]>();
    for (const program of programs) {
      for (const [id] of program.nativeProgram().entries()) rules.set(id, []);
      for (const source of program.sourceCosts()) {
        if (!source.portable) { rules.delete(source.clauseId); continue; }
        groups.set(source.group, { id: source.group, encodedBytes: source.encodedBytes, clauses: source.clauses });
        rules.set(source.clauseId, [source.group]);
      }
    }
    const cost = { maxGroups: protocol.limits.maxProofSteps,
      maxBytes: budget?.maxBytes ?? protocol.limits.maxProofBytes,
      maxClauses: budget?.maxClauses ?? protocol.limits.maxProofSteps,
      maxAccountNodes: budget?.maxSteps ?? protocol.limits.maxProofSteps,
      maxAccountDepth: protocol.limits.maxProofDepth,
      maxTermDepth: protocol.limits.maxTermDepth,
      reservedEnvelopeBytes: portableEnvelopeReserve(budget?.maxBytes ?? protocol.limits.maxProofBytes, protocol.limits.maxProofSteps) };
    const binding = deriveCheckProfileSpec(state.profile);
    const digest = createHash("sha256").update(JSON.stringify({ programs: programs.map(p => p.identity), cost,
      root: hex(encode(state.config.root)), profile: binding.digest().toHex() })).digest();
    return { kind: "portable", identity: ComponentBinding.of("thesmos/signed-source-catalog", "1", Digest.of(digest)),
      groups: [...groups.values()], budget: cost, entries: [
        ...[...rules].map(([id, sourceGroups]) => ({ source: { kind: "rule" as const, clauseId: ClauseId.of(id), meta: NodeMeta.none() }, groups: sourceGroups })),
        { source: { kind: "leaf", fact: inputLiteral(fact("root", state.config.root)), evidence: Evidence.none() }, groups: [] },
        { source: { kind: "builtin", binding: binding.theories[0]! }, groups: [] },
      ] };
  }

  async request(request: SpacesRequestOptions): Promise<SpacesPreparedRequest> {
    const state = this.#live(), { base, lease, config } = state;
    const query = Object.freeze({ actor: copyValue(request.query.actor), space: copyValue(request.query.space), statement: copyValue(request.query.statement) });
    const carryingBudget = request.carryingBudget && Object.freeze({ ...request.carryingBudget });
    const required = request.portable === "required", signal = request.signal;
    const overlay = prepareSpacesOverlay({ bundles: request.observations, authenticate: config.authenticate, budget: config.preparationBudget });
    const execution: PreparedQuery = await lease.request({ goal: inputLiteral(authorization(query.actor, query.statement, query.space)).toGoal(),
      fragments: instantiateSpacesObservations(overlay, config.observationTemplates ?? []), limits: config.limits,
      support: required ? this.#portableSupport(state, [base, overlay], carryingBudget) : { kind: "local" },
      evidence: required ? { policy: "generate", retention: "retain", verify: { kind: "every" } }
        : { policy: "none", retention: "discard", verify: { kind: "none" } }, witnessCapture: "retain" });
    try {
      return new PreparedSpacesRequest({ execution, admission: execution.admission(), root: config.root, query,
        programs: [base, overlay], authenticate: config.authenticate, required, carryingBudget, signal });
    } catch (error) { execution.close(); throw error; }
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
    const state = this.#state;
    this.#state = undefined;
    if (!state) return;
    try { state.lease.close(); } finally { state.owner.close(); }
  }
}

export const createSpacesRuntime = (config: SpacesRuntimeConfig): Promise<SpacesRuntime> => SpacesRuntime.open(config);
