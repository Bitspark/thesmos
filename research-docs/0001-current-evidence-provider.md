# Research: A minimal provider boundary for current Spaces evidence

**ID:** 0001
**Date:** 21 October 2026
**Status:** delivering
**Run-ID:** run_8fc85688-7f02-4d07-985c-5c270dc83485
**Reviewed:** https://github.com/Bitspark/thesmos/issues/7#issuecomment-6307905226
**Graded:** https://github.com/Bitspark/thesmos/issues/7#issuecomment-6308414312
**Owner:** Spaces/thesmos SDK maintainer
**Issue:** https://github.com/Bitspark/thesmos/issues/7
**Source:** https://github.com/Bitspark/thesmos/tree/705807de1bc10ca960c39cb728faaf78f08d3c1e

## Question

What is the smallest reusable provider contract for acquiring authenticated
Spaces clauses and selecting applicable evidence at the receiver, while
preserving the frozen authority law and keeping temporal policy separate?

An account service will be the default provider. Independently operated,
delegated providers must also work. Ordinary users authenticate to Accounts;
they need no personal native signing key. This document asks about the provider
boundary and an optional identity encoding, not a replacement authorization model.

## Model and vocabulary

Spaces uses a fixed positive logic program, evaluated and checked by Logos.
Ontos supplies native atoms (opaque bytes) and tuples (ordered native values),
with canonical codecs and text embeddings. A space is a proper Logos list of
path segments. Archon supplies optional cryptographic signature authentication.
An identity in the law is an arbitrary native value, not necessarily a key.

`authorized(actor, statement, space)` is the authority query. The root has every
authority, rights extend to descendants, holding and conferring a right are
equivalent, and counting grants establish rights. Delegation retains the
issuer's authority. An attributed authored clause counts only when its body
holds and the author is authorized for that instantiated conclusion. A fact
is an authored clause with an empty body. Variables are handled by Logos.

An asserter (called supplier in the SDK) is authorized for the ordinary
statement `supply_facts` at a space. It supplies clauses preserving their authors.
Its authenticated assertion is trusted for attribution and the time of its live
assertion. No independent original-author signature is mandatory. Author
authority still has to be proved; it is not independent authentication of
historical authorship. Do not propose an additional publication privilege.

Each supplied clause is specialized to the following shape, where `A` is the
author, `S` the supplier, `P` its exact placement, `H` the instantiated head, and
`Body` the authored positive premises. This is a schematic template; authored
heads may contain variables, which Logos instantiates in a proof conclusion:

```prolog
counts(A,P,H) :- Body, authorized(A,H,P), authorized(S,supply_facts,P).
```

Both guards use the same frozen law and finite rooted proof. An authorized
ancestor can supply a descendant directly. Supplier authority is not exclusive:
a source routing prefix does not cancel other authorized routes. Unsupported
circular self-appointments do not establish rooted authority.

The root may be an operationally offline trust anchor. An existing supported
non-root principal can confer authority, including supplier authority; the root
does not have to sign every new grant or be contacted for each operation.

## Current public implementation

These declarations are from `core/ts/src/types.ts` at the source revision above.
`Value`, `Clause` and `Derivation` are native Logos/Ontos objects.

```ts
interface Query {
  readonly actor: Value;
  readonly space: Value;
  readonly statement: Value;
}
interface SpaceFacts {
  readonly supplier: Value;
  readonly space: Value;
  readonly assertedAt: Value;
  readonly clauses: readonly Clause[];
}
interface SpaceFactsBundle {
  readonly payload: Uint8Array;
  readonly authentication: Value;
}
type AuthenticateSpaceFacts =
  (request: SpaceFactsBundle & { readonly supplier: Value }) => boolean;
interface Proof {
  readonly law: Atom;
  readonly layer: Atom;
  readonly bundles: readonly SpaceFactsBundle[];
  readonly derivation: Derivation;
}
```

`bundles.ts` encodes the entire payload as the native tuple below. `clauseValue`
is Logos's standard clause encoding. All payload bytes, including author,
placement, variables, body and timestamp, are authenticated as a whole. The
layer rejects a clause whose placement differs from its bundle's exact space.

```ts
encode(new Tuple([
  atom("space_facts"), output.supplier, output.space, output.assertedAt,
  new Tuple(output.clauses.map(clauseValue)),
]));
```

The Archon adapter verifies a signature atom over these exact bytes using the
supplier's public-key atom in signature domain `thesmos/space-facts/v1`.
Only the supplier must be a key under this adapter. Actors/authors remain native
values. The verifier can instead take another authentication callback.

`encoding.ts` exposes:

```ts
function attributedClause(author: Value, space: Value, input: Value | Clause): Clause;
function authorization(actor: Value, statement: Value, space: Value): Value;
```

Attributed inputs have a `counts(author,space,head)` head, with the original
body retained. Author and placement are ground; variables in the conclusion
and positive body remain native. Current supported authored body predicates
are positive `authorized/3` and `counts/3`. The layer adds the two guards above.

The root module exposes a local verifier:

```ts
// query: Query; proof: Uint8Array (encoded Proof, not the decoded object)
createSpacesVerifier({ root: configuredRoot, authenticate }).verify({ query, proof });
// encodeProof(proof: Proof): Uint8Array; decodeProof(bytes: Uint8Array): Proof
// Decision: { permitted: boolean, code: string, detail?: string, checkedSteps?: number }
```

It checks the law/layer digests, authenticates every bundle, reconstructs the
guarded program and uses the Logos checker to check the exact query. The only
external premise is the configured root. It performs no search, network or
clock call. The receiving service authenticates its actor, constructs the
actual operation/space and executes any effect after acceptance.

The optional `/client` entry performs Logos search:

```ts
prove({ root, query, bundles, limits? }, signal?): Promise<Uint8Array>;
```

It consumes the provided bundles and returns a proof carrying all of them.
Search reconstructs the candidate program without the authentication callback;
the receiver authenticates it when checking the returned proof. Derivation
is Logos's finite proof certificate. Receiver limits include 1 MiB encoded
proof bytes, 2,048 bundled clauses and 2,048 proof nodes; unused input bundles
also consume the applicable budgets.
It currently does not prune unused bundles, fetch evidence, discover sources or
select current facts. `ProofSearchError` distinguishes exhausted search from
incomplete search; neither proves universal prohibition. Search is bounded,
including a current 256 MiB Logos WebAssembly memory ceiling.

No law, assertion template, asserter template or existing proof-wire change is
authorized. Store, transport, expiry, source discovery and applicability are
separate implementation/profile concerns. Signed `assertedAt` alone establishes
neither latest state nor a universal cache lifetime.

## Concrete composition to deliver

1. A user logs in to the account issuer. The server establishes a stable actor.
2. The user approves an exact native attributed clause. Accounts records its
   authenticated attribution and may later withdraw the record. Accounts signs
   its supplied output with its service key; it does not impersonate a personal
   signature. Stored history and the currently supplied set are distinct.
3. A prover gathers candidate clauses, including supplier appointments, author
   support, rules, intermediate grants and cross-space premises, from configured
   providers. Discovery is not authority and absence in one source is not denial.
4. A receiver independently selects applicable evidence, checks the actual
   actor/operation/space with thesmos and executes its own effect.

Acceptance uses synthetic Alice, Bob and Carol account principals. A supported
non-root authority grantor grants Alice; Alice grants Bob; Bob grants Carol. A variable
conditional rule and separately supported supplier chain must survive intact.
Removing a required author's standing/support or withdrawing a grant removes
that proof route. A separately valid alternative route must still work. This
is not a global negative suspension axiom.

Standing means the service profile's account-status condition (for example,
active rather than disabled or held); support means clauses needed in an
authority proof. The required consumer sequence is to authenticate and check
the request actor's current account status, obtain currently selected source
outputs, check the exact proof, and then execute the effect. Account records
must also preserve their author's authenticated submission generation;
current source selection must account for relevant author standing/generation
changes. These are consumer constraints supplied to this review, not SDK
implementation claims. A current successful service read is required, including
outage refusal, until a separately qualified policy replaces that requirement.
A bounded-age example cannot silently weaken this selected currentness policy.

## Proposed minimal identity profile

One optional helper maps an already authenticated issuer/subject pair to:

```ts
new Tuple([
  atom("thesmos/issuer-subject/1"),
  encodeText(issuer),
  encodeText(subject),
]);
```

Both strings are nonempty well-formed Unicode and preserve the exact scalar sequence;
there is no URL, case, slash or Unicode normalization. Ontos `encodeText` and
`readText` provide canonical native text. The provider's stable subject is
never reassigned. Preserving the issuer/database identity lineage is an
operational obligation: the account identity namespace and its subject assignments
continue together. Here the account issuer names that namespace, distinct from
an authority-granting principal. Creating a fresh issuer lineage cannot reuse old IDs
as if it were continuity. Mutable credential generations and standing are
profile evidence, not identity fields. Existing key principals are distinct;
grants are not silently reassigned. The helper does not authenticate a string.

## Provider alternatives and the actual tension

Issue 7 proposes a transport-neutral `SpaceAsserter.supply(request, call)`.
The request includes root, exact space, bounded selector, evidence requirements
and paging. A bounded selector limits which candidate records are requested;
evidence requirements identify an explicitly chosen applicability profile.
Response candidates are bundles, descriptive coverage and optional
continuation; typed failures include unavailable, unsupported profile,
not disclosed, selection changed and limit exceeded. The implementer's
transport establishes the call context; it is not an accepted caller identity
field. Coverage describes whether this page covers the requested selector,
without asserting authority or absence of another proof. Unsupported profile
means the provider cannot satisfy the requested evidence requirements. A
conceptual call asks for all candidate clauses at `[team]` under a named live
profile and returns its first page or an explicit inability to supply it.
Whether that reply establishes a current selected set, merely retrieves
candidates, or supports both through explicit profiles is part of this review.
No public implementation of this interface exists yet.

For the first consumer, a smaller adapter may suffice:

```ts
interface SpaceFactsSnapshot {
  readonly revision: Value; // opaque source-defined token, not a global ordering
  readonly bundles: readonly SpaceFactsBundle[];
}
interface SpaceFactsSource {
  read(signal?: AbortSignal): Promise<SpaceFactsSnapshot>;
}
```

The receiver chooses and authenticates these endpoints, reads current snapshots
and requires every bundle in the submitted proof to appear byte-for-byte in
its selected union. Existing signature and rooted proof checks still run.
Stable stored bundles permit this comparison. On change, a source changes its
current selection; historical bundles can remain stored without remaining
selected. The revision is descriptive unless a selected protocol explicitly
binds and uses it. A request's source choice cannot override the receiver's.

Because the current prover carries all input bundles, a proof using route B
but also carrying unused route A will fail whole-bundle membership after A is
withdrawn. The required alternative-route success is a new proof built using
surviving B, not automatic acceptance of the old proof. Issue 9 separately
proposes pruning unused bundles to reduce this avoidable coupling.

This does not make separate source reads atomic. There may be concurrent
changes or a change between validation and effect. Those guarantees must be
stated by a receiver's chosen operation/profile, not silently invented by a
generic helper. A live assertion may legitimately be renewed at a new time;
an old historical payload must never be relabeled as newly asserted merely
because it was fetched. Renewing `assertedAt`, or otherwise changing payload
or authentication bytes on every read, prevents exact membership matching
against a previously built caller proof; signing unchanged bytes need not.

A bounded-age profile would instead accept sufficiently recent live assertions
under explicit per-use requirements. That is a useful separate candidate, not
the current receiver policy. Adding a complete source framework before a
concrete consumer needs it risks unnecessary fields and frozen assumptions.
Conversely, independently invented snapshot and supply interfaces would create
two competing public provider contracts. We want one minimal composable seam.

## Questions for the expert

1. Which provider obligations and fields are irreducible for this concrete
   composition, and which can remain explicit consumer adapters/configuration?
2. How should current receiver-selected membership and newly live asserted
   timestamps compose while retaining their distinct meanings? Assess the
   stable snapshot option and the richer supply option against that requirement.
3. Which conformance principles and cases demonstrate preserved author/supplier
   support, alternative authorized routes, explicit snapshot-consistency guarantees
   and accurate interpretation of unsuccessful proof search under the unchanged law?
4. Where does the proposed issuer/subject native-value profile preserve or blur
   the separation of identity, authentication and mutable lifecycle? Ground any
   proposed change in a concrete failure case.
5. What is the simplest useful design we have overlooked, or the strongest
   counterexample to the proposed boundary?

## Prior-work reuse check

The fresh public successor has no research-docs corpus. The service's old
`thesmos-research` collection concerns the private predecessor and a different
law; its private research/history is not imported. A separate
`thesmos-core-research` collection is empty at preparation. Current source,
issues 7/11 and the concrete consumer constraints above form this brief.

## Applied

This heading tracks delivery; the consultation is **delivering**, not applied.
The preceding brief describes the submitted proposal. The disposition below
supersedes its unqualified selected-union description: mutable source outputs
must retain their configured selection responsibility across providers.

Attempt 1 submitted 15,191 bytes with SHA-256
`b74dc338a9de3f8513238bf68367c9fd80809443ecfedc81f79ae696fc3f109d`.
Run `run_8fc85688-7f02-4d07-985c-5c270dc83485` completed; service verification
returned exit 0 and matched the local raw advice, 28,998 bytes with SHA-256
`543f68b83d38b197f3746b9e0ea0c7f89e044f1e77072f83efe4b612ad339077`.
The submitted snapshot and raw response are retained unchanged.

Evaluation inspected thesmos `705807de1bc10ca960c39cb728faaf78f08d3c1e`,
SDK implementation `506ab68a7258a04fe2056e79108a03cfaca33d72` and Accounts
`2b553f27c5089c0a52b2f74e57ba8575cdfcc9a1`. The SDK change was independently
reviewed and delivered as main `f8b69abda15a6a3c964c664cdf0063d0c64dcbae` and
`v1.0.0-preview.2`; its source gates passed 95 tests and all eight frozen-artifact
checks. The Accounts source review is not its full gate or live qualification.

In the table, **SDK** is the thesmos maintainer; **Accounts** is the receiving
implementation owner; **Auditor** is the independent platform reviewer.

| # | Recommendation | Verdict | Action | Owner | Link | Validation |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | One small configured read boundary | NEEDS ADAPTATION | Use the existing internal adapter. Add a public type only when a concrete interoperable caller needs it; avoid competing read/supply protocols. | Accounts; SDK | [Provider profile](../docs/evidence-selection.md), [Accounts PR63](https://github.com/Bitspark/bitspark-accounts/pull/63), [issue 7](https://github.com/Bitspark/thesmos/issues/7) | Two concrete source implementations under the same receiving boundary; exact Accounts gate pending. |
| 2 | Give revisions an explicit protocol meaning | HOLDS | Keep source revision and local fence meaning service-owned; no mandatory model field. | Accounts | [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | Source-change, retry and local-fence cases; exact gate pending. |
| 3 | Preserve source-selection responsibility | HOLDS | Reject stale Accounts outputs replayed by another endpoint; preserve independently signed authorized alternatives. | Accounts | [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | `independent-provider.test.ts` replay/alternative pair and `document-portal.test.ts` foundation replay; exact gate pending. |
| 4 | Persist complete payload and authentication | HOLDS | Store immutable signed outputs; compare complete bundle identity at receipt. | Accounts | [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | Stable repeated selection, restart, mutation and withdrawal cases in `space-records.test.ts`; exact gate pending. |
| 5 | Deselect all affected whole-bundle versions | NEEDS ADAPTATION | One bundle per record avoids mixed-record replacement now; document the obligation before batching. | Accounts; SDK | [Profile](../docs/evidence-selection.md), [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | Withdrawal, independently live identical output and fresh reauthoring in `record-proposals.test.ts`; exact gate pending. |
| 6 | Retain the actual authenticated approval generation | HOLDS | Compare proposal-captured epoch/outbox and exact clause inside the insertion transaction; authenticate HTTP session/CSRF after bounded body acquisition. | Accounts | [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | Delayed epoch/outbox approval, altered author/body and slow-body cases in `record-proposals.test.ts` and `record-http.test.ts`; exact gate pending. |
| 7 | Define lifecycle; avoid resurrection and cascading deletion | HOLDS | Explicit source lifecycle controls selection. Reauthoring is a fresh act; remaining authority paths are checked by the law. | Accounts | [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | Hold, recovery, re-enable, immutable withdrawal, new approval and surviving-route pairs; exact gate pending. |
| 8 | Separate source-local, cross-source and effect consistency | HOLDS | Document coherent local reads, required observations and local effect fences; claim no global atomic snapshot. | Accounts; Auditor | [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63), [platform issue 237](https://github.com/Bitspark/platform/issues/237) | Concurrent source change, final-await fence and required-provider outage cases; exact gate pending. |
| 9 | Coordinate when joint or effect-time remote validity is required | DEFERRED | Trigger: a concrete operation requires a stronger guarantee than this observation profile. Its receiver owns the protocol. | Receiving service | [Profile](../docs/evidence-selection.md) | Current documentation explicitly states the weaker guarantee. |
| 10 | Exact issuer/subject native identity, separate authentication | HOLDS | Deliver optional `/identity`; retain exact Unicode with no implicit normalization or key aliases. | SDK | [PR14](https://github.com/Bitspark/thesmos/pull/14) | [Run39545194402](https://github.com/Bitspark/thesmos/actions/runs/39545194402): native roundtrips, malformed shapes and identity separation pass. |
| 11 | Preserve identity and provenance continuity through recovery | HOLDS | Record namespace, generation, withdrawal and authenticated history obligations; production backup drills remain outside this development scope. | Accounts; SDK | [Profile](../docs/evidence-selection.md), [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | Restart, lineage and stale-context refusal tests; exact gate pending. |
| 12 | Separate actor eligibility, evidence applicability and authority | HOLDS | Keep those checks distinct; reconstruct the actual receiver query. | Accounts; SDK | [PR14](https://github.com/Bitspark/thesmos/pull/14), [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | SDK changed-query cases pass; paired receiving-boundary cases remain pending. |
| 13 | Preserve complete native chains without personal keys | HOLDS | Exercise non-root suppliers, both onward grants, variables, conditions and alternatives without custom grounding. | SDK; Accounts; Auditor | [PR14](https://github.com/Bitspark/thesmos/pull/14), [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | SDK 95/95 pass, including two titles through the same variable rules. Accounts actual conditional-title chain and installed journey remain pending. |
| 14 | Bound acquisition separately and preserve failure meaning | HOLDS | Bound reads/decode and refuse incomplete data; retain typed native search/capacity failure. | Accounts; SDK | [PR14](https://github.com/Bitspark/thesmos/pull/14), [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | SDK capacity witness passes; receiving outage, oversize and changed-data cases pending. |
| 15 | Pin pagination and coverage when added | DEFERRED | Trigger: first paged interoperable adapter. The current unpaged adapter must refuse, not truncate, oversized selections. | SDK; Accounts | [Issue 7](https://github.com/Bitspark/thesmos/issues/7), [issue 11](https://github.com/Bitspark/thesmos/issues/11) | Current bound/refusal checks; no completeness or global non-authority claim. |
| 16 | Separate current selection from cached immutable objects | NEEDS ADAPTATION | Existing selection over stored bundles already provides this composition; add no manifest protocol. | Accounts | [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | Stable-byte and changed-membership cases; exact gate pending. |
| 17 | Select only proof-relevant positive evidence | DEFERRED | Trigger: full bounded selection exceeds an actual receiver budget. Extend the same adapter if required. | SDK; receiving service | [Issue 7](https://github.com/Bitspark/thesmos/issues/7) | No optimization is claimed for current full selections. |
| 18 | Permit receiver-owned proof construction | HOLDS | Prove using receiver-selected bundles and verify the same actual query before effect. | Accounts | [PR63](https://github.com/Bitspark/bitspark-accounts/pull/63) | Actual actor/title/effect and final current-selection tests; exact gate pending. |
| 19 | Prune unused bundles | DEFERRED | Keep the existing scoped pruning work separate. Until delivered, rebuild proofs using surviving selections. | SDK | [Issue 9](https://github.com/Bitspark/thesmos/issues/9) | New proof through an alternative succeeds; old unused deselected evidence is not silently current. |

No mandatory author signature, publication privilege, global lease, expiry
default, role registry, new law axiom or cascading revocation is accepted.
Accounts remains responsible for the service implementation and deployment.
The Auditor independently verifies its exact delivered state. This research
remains delivering until the accepted receiving cases have passing evidence;
library qualification alone does not complete those rows.
