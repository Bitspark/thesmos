# The shared Spaces runtime

Decision record, 21 October 2026. It answers [issue 5](https://github.com/Bitspark/thesmos/issues/5),
based on Bitspark/concepts consultation 0003 (verified advice, evaluated and graded). It changes
no `law/` artifact and no existing entry point. Nothing described here is implemented yet; the
production gate is [issue 19](https://github.com/Bitspark/thesmos/issues/19).

## Why a runtime

`prove` searches. Services that decide on every request need answers in about a millisecond,
under writes and withdrawals. Search takes seconds on realistic policies with variables, and
`check` costs tens of milliseconds per proof. Decisions therefore come from an indexed evaluation
of the same law. Checking supplied proofs stays a separate interface.

## Where it lives

| Responsibility | Owner |
| --- | --- |
| Frozen law, layer, term interpretation and proof-envelope meaning | thesmos |
| Indexed joins, variable binding, demand propagation, recursive evaluation, witnesses, later incremental maintenance | logos ([request](https://github.com/Bitspark/logos/issues/3816)) |
| Spaces profile, admission, evidence selection, witness-to-proof export, conformance corpus | thesmos, as a thin optional runtime package; logos takes part in compatibility approval |
| Persistence, observation acquisition, clocks, operation mapping and effects | consumers |

The runtime package assembles these pieces. It contains no hand-written implementation of root
authority, grants or delegation. The receiver entry point keeps importing no search engine and no
runtime.

## One meaning, two evaluation paths

The law and layer are the sole specification of authority. An evaluator for an admitted profile
may make **local** decisions under the shared conformance contract below. Its unchecked answers
authorize local effects, so it is **trusted** for those decisions; provenance and differential
testing justify that trust but do not remove it. **Portable** proofs must pass the unchanged
checker, and the receiver does not trust the producer. Consumer adapters implement no
authorization semantics of their own.

## Result contract

| Result | Meaning |
| --- | --- |
| `permitted` | The exact query is derivable from the accepted selected evidence. |
| `forbidden` | Evaluation completed over the required evidence scope, within the admitted profile, and found no derivation. This is relative to that scope, not a claim that no evidence anywhere could establish the right. |
| `unavailable` | A required source, observation, selection condition or sufficiently current view could not be obtained. |
| `unsupported` | A relevant rule shape, evaluation mode or work budget is outside the profile. A limit never yields `forbidden`. |
| `invalid-proof` | A submitted proof failed acceptance. Another proof may exist. |

Two conforming implementations may differ only where one answers `unsupported` or `unavailable`.
They must never split `permitted` against `forbidden` on the same completed, supported input. A
local permission whose proof cannot be exported, for example because it is too large or because an
observation lacks signed backing, is still a permission. Exportability is a separate result.

## Admitted profile (first version)

- Ground decision queries; finite selected records and rule schemas.
- A binding plan for every relevant clause, including clause heads with variables. For example,
  rule 3 leaves the issuer and the outer space unrestricted relative to the inner right.
- Built-ins only in bound modes; no constructor-growing recursion without an explicit, justified
  finite-demand treatment.
- The demanded recursive closure completes before `forbidden`.

Specialisations (a symbolic root answer, prefix inspection of a ground target, the `authorized/3`
wrapper equivalence, head indexing) are versioned compiler transformations with proof recipes.
A counted grant confers only when its placement is a prefix of the grant's **underlying** space. A
grant to `[]` placed at `[p]` confers nothing at `[p]`, as `core/ts/test/shapes.test.ts` pins. Each
supplied clause keeps both guards, author and supplier, for every ground conclusion.

## Evaluation and export

- A persistent base holds selected attributed clauses, guarded counted records, finite
  request-independent consequences and indexes.
- A request pins one published view and adds its observations to a disposable overlay. Every
  request-dependent consequence is discarded with the overlay.
- Each answer keeps one immutable witness: clause id, full substitution, premise handles,
  evidence ids and height.
- Export expands the witness into original law steps and built-ins, includes author and supplier
  support, and emits the existing envelope with only the whole bundles it uses. It never goes back
  through search. Only `root(R)` is a leaf.
- Retraction maintenance recomputes affected regions from surviving inputs. Witnesses are never
  reference-counted to keep rights alive.

## Selection

Local views and proof acceptance use one selection result, on the receiving boundary of
[evidence selection](evidence-selection.md): whole-bundle membership by exact bytes, under
configured selection responsibility. Bootstrap evidence is a pinned source component. A snapshot
digest identifies contents, not currency or coexistence. Effect commits re-check the decision's
dependencies; a local transaction does not cover remote sources. The public snapshot type lands
with the runtime package ([issue 8](https://github.com/Bitspark/thesmos/issues/8)).

## Conformance

The compatibility identity pins the law, layer, term theory and profile versions. The corpus has
positive and negative cases: non-root authors, supplier chains, per-conclusion author checks,
nested grants, recursive cycles, request isolation and changes over time. Results count false
permissions, false denials, rejected exports and incomplete evaluations separately. Incremental
views are compared with clean rebuilds. Comparison with search applies only where search completes.
