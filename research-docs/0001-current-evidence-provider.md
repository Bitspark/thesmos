# Research: A minimal provider boundary for current Spaces evidence

**ID:** 0001
**Date:** 21 October 2026
**Status:** submitted
**Run-ID:** run_8fc85688-7f02-4d07-985c-5c270dc83485
**Reviewed:** https://github.com/Bitspark/thesmos/issues/7#issuecomment-6307905226
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
