# The shared Spaces runtime

Decision record, 21 October 2026. It answers [issue 5](https://github.com/Bitspark/thesmos/issues/5),
based on an internal design consultation (number 0003: verified advice, evaluated and graded). It
changes no `law/` artifact and no existing entry point. Nothing described here is implemented yet,
and no local evaluator is admitted until the gate in [issue 19](https://github.com/Bitspark/thesmos/issues/19)
passes.

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
