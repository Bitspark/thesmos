# The shared Spaces runtime

Decision record, 21 October 2026. It answers [issue 5](https://github.com/Bitspark/thesmos/issues/5),
based on an internal design consultation (number 0003: verified advice, evaluated and graded). It
changes no `law/` artifact and no existing entry point. The optional `/runtime` source now adapts
Logos prepared sessions, authenticated signed sources and ordinary proof export. Its exact-source
remote qualification is pending; no local evaluator is admitted until the gate in
[issue 19](https://github.com/Bitspark/thesmos/issues/19) passes.

## Why a runtime

`prove` searches. Services that decide on every request need answers in about a millisecond,
under writes and withdrawals. Search takes seconds on realistic policies with variables. `check`
costs tens to hundreds of milliseconds per proof, depending on its size. Decisions therefore come
from an indexed evaluation of the same law. Checking supplied proofs stays a separate interface.

## Where it lives

| Responsibility | Owner |
| --- | --- |
| Frozen law, layer, term interpretation and proof-envelope meaning | thesmos |
| Indexed joins, variable binding, demand propagation, recursive evaluation, witnesses, later incremental maintenance | logos (requested there) |
| Spaces profile, admission, evidence selection, witness-to-proof export, conformance corpus | thesmos, as a thin optional runtime package; logos takes part in compatibility approval |
| Persistence, observation acquisition, clocks, operation mapping and effects | consumers |

The runtime package assembles these pieces. It contains no hand-written implementation of root
authority, grants or delegation. The receiver entry point keeps importing no search engine and no
runtime.

## One meaning, two evaluation paths

The law and layer are the sole specification of authority.

- **Local decisions.** An evaluator for an admitted profile may make local decisions under the
  shared conformance contract below. Its unchecked answers authorize local effects, so it is
  **trusted** for those decisions. Provenance and differential testing justify that trust; they do
  not remove it.
- **Portable proofs** must pass the unchanged checker. The receiver does not trust the producer.
- **Consumer adapters** implement no authorization semantics of their own.

## Result contract

| Result | Meaning |
| --- | --- |
| `permitted` | The exact query is derivable from the accepted selected evidence. |
| `forbidden` | Evaluation completed over the required evidence scope, within the admitted profile, and found no derivation. This is relative to that scope, not a claim that no evidence anywhere could establish the right. |
| `unavailable` | A required source, observation, selection condition or sufficiently current view could not be obtained. |
| `unsupported` | A relevant rule shape, evaluation mode or work budget is outside the profile. A limit never yields `forbidden`. |
| `invalid-proof` | A submitted proof failed acceptance. Another proof may exist. |

Two conforming implementations may differ only where one answers `unsupported`. They must never
split `permitted` against `forbidden` on the same completed, supported input.

A local permission whose proof cannot be exported is still a permission. Export can fail, for
example, because the proof is too large or an observation lacks signed backing. Exportability is
a separate result, and a small derivation does not by itself show that export will fit.

## Admitted profile (first version)

- **Queries and inputs:** ground decision queries, finite selected records and finite rule
  schemas.
- **Binding plans:** every relevant clause needs one, including clause heads with variables. A
  variable that appears in a positive body literal is not automatically bound. In rule 3's
  `authorized(I,authorized(J,F,T),S) :- authorized(I,F,T)`, the grantee `J` and the outer space `S`
  stay unrestricted relative to the inner right.
- **Construction and built-ins:** variables they use obtain finite bindings from the query or from
  bounded indexed relations, and built-ins run only in bound modes.
- **Recursion:** no constructor-growing recursion without an explicit, justified finite-demand
  treatment. The demanded recursive closure completes before `forbidden`.

**Specialisations are generic logos compiler transformations, not thesmos code.** They include a
symbolic root answer, prefix inspection of a ground target, the `authorized/3` wrapper equivalence,
and head indexing with wildcard candidates for variable positions. Each is versioned and has a
proof recipe. Its output expands back into the law's own steps and passes the checker, and it
preserves the original supplied clause, its attribution and its placement.

**Placement.** A counted grant confers only when its placement is a prefix of the grant's
**underlying** space. A grant to `[]` placed at `[p]` confers nothing, at `[p]` or anywhere else,
as `core/ts/test/shapes.test.ts` pins.

**Guards.** Each supplied clause keeps both guards, author and supplier, for every ground
conclusion.

## Evaluation and export

- **Base.** A persistent base holds selected attributed clauses, guarded counted records, finite
  request-independent consequences and indexes.
- **Overlay.** A request pins one published view and adds its observations to a disposable
  overlay. Every request-dependent consequence is discarded with the overlay.
- **Witnesses.** Each answer keeps one immutable witness: clause id, full substitution, premise
  handles, evidence ids and height.
- **Export.**
  - Export expands the witness into original law steps and built-in nodes, and includes author and
    supplier support.
  - It emits the existing envelope with only the whole bundles it uses, and never goes back through
    search.
  - The only external leaf is `root(R)`.
- **Retraction maintenance** recomputes affected regions from surviving inputs. Witnesses are never
  reference-counted to keep rights alive. With a coarse dependency graph an affected region can be
  most of an installation; finer partitioning needs justification from actual term shapes.

## Selection

Local views and proof acceptance use one selection result, on the receiving boundary of
[evidence selection](evidence-selection.md): whole-bundle membership by exact bytes, under
configured selection responsibility.

- **Bootstrap evidence** is a pinned source component with a configuration generation. Pinning
  does not bypass authentication or the supplier-authority guard.
- **A snapshot digest** identifies contents, not currency or coexistence.
- **Effect commits** re-check the decision's dependencies. A local transaction does not cover
  remote sources.

Until the provider interface of [issue 7](https://github.com/Bitspark/thesmos/issues/7) settles,
the selection result is internal to each receiver. Its public form, with `verifyForUse`, is
[issue 8](https://github.com/Bitspark/thesmos/issues/8).

## Conformance

- **Compatibility identity:** it pins the law, layer, term theory and profile versions.
- **Corpus:** positive and negative cases covering non-root authors, supplier chains,
  per-conclusion author checks, nested grants, recursive cycles, request isolation and changes
  over time.
- **Results** count false permissions, false denials, rejected exports and incomplete evaluations
  separately.
- **Comparisons:** incremental views against clean rebuilds, and search only where search
  completes.

## Current source interface

`createSpacesRuntime({root, bundles, authenticate, preparationBudget, observationTemplates})`
authenticates and captures the selected base, then prepares the existing Logos `Session`.
Preparation limits bound acquired bundles, clauses and payload bytes separately from the frozen
portable envelope limits. A source is identified by its exact payload and authentication bytes.
Two sources containing equal clauses remain separate alternatives with distinct original clause
IDs. A whole signed output is indivisible at export.
Preparation records whether each complete source fits the frozen envelope's authentication
depth, tuple-arity and atom-size limits. A source may remain usable locally while required
portable selection excludes it and considers fitting alternatives.

Every `observationTemplates` entry is a generic Logos `FragmentTemplate`: a native guarded clause,
a name and explicitly declared ground preparation parameters. `request({query, observations})`
authenticates supplied observations, matches their exact clause syntax to these declarations and
submits instances with their original source IDs. It never promotes an observation to an
extensional fact. New variable policy requires a prepared replacement.

`request()` returns an admitted request with `admission`, `run()` and `close()`. Admission may do
constructive native demand work, retained for `run()`; measure both calls. `decide()` combines them
and returns `permitted`, `forbidden` or `unsupported`. Only a completed local absence produces
`forbidden`. Named Logos refusals remain available on `unsupported.refusal`; acquisition and
authentication errors throw `PreparationRefused`. Neither is a permission decision.

Runtime, admitted request and retained witness objects expose `diagnostics()` as a direct typed
view of Logos's read-only counters. Base clauses, index entries, supports, request overlays and
execution work are logical counts; encoded capsule bytes are measured bytes. They are not heap
or RSS estimates. Closed live handles report the provider's named error instead of invented zero
counts. Process memory and its peak must be measured separately by the host.
Closing a runtime, request or witness releases its owned host references to policy and signed
source data as well as its native handle. Closed objects reject new work; an operation already
started keeps its captured context until it settles. An independently retained witness survives
request and runtime closure until the witness itself closes.

A permitted result owns a witness. Close it after use. The default fast path asks Logos for no
ordinary generated account and separately retains private support; `witness.export()` materializes
that support, maps exact source IDs to complete signed bundles and checks the unchanged proof.
It performs no search and remains available after the request, base replacement and owner retire.
An optional export can return `unavailable` while the local permission remains valid. With
`portable: 'required'`, native selection considers eligible source alternatives and distinct whole
bundle byte/clause costs, with ordinary evidence generation and verification explicitly enabled.
The adapter measures and independently checks the actual final envelope
before returning the permitted result and its `proof`; a source budget alone is insufficient.

The native portable budget includes FIRM account bytes, the account-node bound and the frozen
proof-depth and term-depth bounds, so an oversized candidate cannot suppress a fitting alternative.
The remaining
Spaces envelope reserve is calculated from the frozen Ontos codec: the outer tuple header, encoded
format/law/layer values, the bundle tuple header at the maximum group count, and the account atom
header at the maximum wrapped account byte length. It also includes the public
`proof-interchange/derivation/v1` tuple and tag around the native FIRM payload. Bundle children are
charged separately in full.
Original `supplied/<64 hex digits>/<index>` rule IDs become shorter `bundle/<position>/<index>`
IDs; export asserts that this never enlarges an atom. All other account nodes remain unchanged,
so the measured native account plus that reserve is a conservative byte bound. Boundary tests
compare the reserve with actual envelope bytes across unsigned-LEB128 length/arity changes and
an independently accepted law-only proof, which has no source IDs to shorten.

`replace(bundles)` prepares the new base before publishing it atomically. Already opened requests
and retained witnesses keep their original interpretation. This first adapter rebuilds replacement
views; it does not claim incremental retraction maintenance. `baseIdentity` identifies exact source
contents. A consumer whose record projection depends on actor, credential or time must include
that dependency in base selection; an authority revision label is not proof that two bases match.

The built-in factory, finite admission and source selection require the Logos prepared-session
candidate. The Nightyard source-pinned gate builds its exact guest and packages, runs this
repository's complete check with an independent candidate tarball install, and then exercises the
actual guarded policy. The normal package pins must advance to a qualified Logos release before
this source becomes a releasable runtime.
