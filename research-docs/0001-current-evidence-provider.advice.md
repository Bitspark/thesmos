# Advice for consult
**Research doc:** doc_7daa5de2-a4b4-4ba2-8296-298a7c9dab3d.md
**Document:** doc_7daa5de2-a4b4-4ba2-8296-298a7c9dab3d
**Advisor:** ChatGPT, model "6 Pro" as labelled on the answer page
**Session:** nsess_44c3f1e9-05fc-417d-930c-be5603300a16
**Run:** run_8fc85688-7f02-4d07-985c-5c270dc83485
**Chat:** https://chatgpt.com/c/6ad83d71-15a8-83ed-8289-d1bda80d46ed
**Verify:** nightfall consult verify run_8fc85688-7f02-4d07-985c-5c270dc83485 --output <this file>

## Recommendation

**Use the smaller, receiver-configured `SpaceFactsSource.read()` boundary for the first consumer, and make its successful-read semantics explicit.** Keep the frozen law, assertion template, proof wire, and proposed issuer/subject encoding unchanged.

The important contract is what the provider promises: **a successful read selects these exact bundles under the receiver’s chosen applicability profile, including the relevant account-lifecycle conditions.** That promise must be distinguished from retrieving authentic historical bundles.

I would not publish `read()` and `supply()` as independent provider contracts. Start with the small interface, with scope and profile bound by configuration. A richer supply protocol can implement that interface, or the same public seam can evolve when a concrete consumer needs dynamic selectors or pagination.

This review treats the implementation excerpts and consumer requirements in the attached brief as authoritative for the discussion. I could not independently retrieve the linked GitHub source and issues, so this is a design review against the supplied material rather than a source-code audit. research(20261021-041852)

## 1. The smallest useful provider contract

The proposed source interface is sufficient for a bounded first consumer:

```ts
interface SpaceFactsSnapshot {
  readonly bundles: readonly SpaceFactsBundle[];
  readonly revision?: Value;
}

interface SpaceFactsSource {
  read(signal?: AbortSignal): Promise<SpaceFactsSnapshot>;
}
```

The optional `revision` is my suggested adjustment. For one unpaged read, returning exact selected bundles is sufficient for membership checking. A revision becomes necessary only when a selected protocol gives it a job, such as pinning pages or participating in a conditional operation. Keeping it mandatory for operational convenience is also reasonable; it should not be presented as providing freshness by itself.

The endpoint, transport authentication, scope, applicability profile, and limits can be bound when constructing the source. They do not need to appear in every call.

### What must be specified, even if it is not a field

| Obligation | Why it is necessary | Where it can live |
|---|---|---|
| Return exact bundle payload and authentication values | A proof must carry the same authenticated objects that were selected | Response |
| Authenticate the source making the selection claim | A historical supplier signature does not authenticate a present selection decision | Transport or source adapter |
| Define the source’s selection responsibility and scope | Receiving a bundle from an endpoint does not automatically make that endpoint competent to establish its current applicability | Receiver configuration and profile |
| Apply relevant author standing and submission-generation rules | A fresh response can otherwise return records whose approvals have become ineligible | Provider implementation or explicit consumer adapter |
| Obtain the required successful current service read | Cached success cannot satisfy the selected outage-refusal policy | Profile |
| State the consistency guarantee | “Snapshot” must have a defined meaning within its scope | Profile and implementation |
| Bound acquisition and decoding | The verifier’s proof limits do not themselves bound provider-response acquisition | Consumer configuration and explicit failures |

The root, exact space, selector, evidence requirements, coverage, and paging fields proposed for `supply()` are useful when those choices vary per call. They are not all irreducible fields for a source whose configuration already fixes them.

A calling service’s identity should continue to come from authenticated transport context. Supplying an identity field in a request must not establish that identity.

### Define successful selection precisely

For the initial live profile, I would specify success approximately as follows:

> The configured source has completed a successful current read and selects the returned immutable bundles within its declared scope, according to the profile’s author-lifecycle rules and stated consistency guarantee.

That statement is stronger than “these bundles have valid signatures.” It also makes clear why an independent provider might be able to retrieve candidates yet be unable to satisfy the requested live profile.

There is a necessary distinction within “receiver independently selects”:

- If it means **independent of the caller’s choices**, the snapshot approach works: the receiver chooses its sources and decides which source outputs to accept.
- If it means **independently auditing every historical submission-generation binding without trusting the provider**, the snapshot response does not expose enough information. That would require additional profile evidence outside the existing proof wire.

The brief appears to intend the first meaning. Make that explicit. The local rooted proof does not establish the correctness of a provider’s account-lifecycle database.

### Selection responsibility is the most important missing detail

Consider this case:

1. Accounts source A signs bundle `b`.
2. Alice’s relevant submission generation becomes ineligible, so A deselects `b`.
3. Another configured endpoint B continues returning an archived copy of `b`.
4. The receiver freshly reads A and B.
5. Naïve union membership accepts `b` because B returned it.

The supplier signature remains valid. The rooted proof might remain valid. Yet the intended lifecycle exclusion has been bypassed.

The solution is to define which current-selection claims the receiver accepts from each source. A mirror responsible for reflecting A’s current selection must validate that selection, or fail to satisfy the live profile. An endpoint returning historical bytes has not automatically established their current applicability.

This does **not** make supplier authority exclusive. An independently authorized supplier can supply a separate, valid assertion route that satisfies the chosen lifecycle profile. Withdrawing one source’s record is not a global negative authorization fact. The distinction is between a valid alternative assertion and a stale copy of the withdrawn evidence.

### Completeness needs a scope

For the first adapter, the simplest behavior is a complete selected set within a configured, bounded scope. If the source cannot return that promised set within limits, it should report inability rather than silently truncate.

But complete enumeration of a space is not necessary for the soundness of a positive proof. A smaller selected subset may be sufficient. Keep these concepts separate:

- **Protocol completeness:** the source fulfilled its declared selector or snapshot request.
- **Global authority completeness:** every possible source and proof route has been considered.

Coverage can describe the first. It cannot normally establish the second.

## 2. Current membership and `assertedAt` compose cleanly if bundles are immutable

The stable snapshot option is sound for the policy in the brief. The two statements being established are different:

| Evidence | What it establishes |
|---|---|
| Authenticated `assertedAt` inside a bundle | The supplier’s assertion time for those exact payload bytes |
| Successful current source read | The configured source currently selects that immutable assertion under the chosen profile |
| Rooted proof | The selected authenticated clauses establish the exact authority query under the frozen law |

An old `assertedAt` does not by itself make a currently selected bundle ineligible. A recent `assertedAt` does not by itself establish that a bundle remains selected. Neither supplies an implicit cache lifetime. That distinction is already correct in the brief and should remain central to the implementation. research(20261021-041852)

### Persist the complete bundle

Persist the authentication value as well as the payload.

If a provider signs unchanged payload bytes again, the resulting authentication might still change—for example, because of the authentication scheme, wrapper, or signing-key rotation. Under exact whole-bundle membership, that is a different object.

The membership comparison should therefore cover:

- Exact payload bytes.
- The canonical native encoding of the authentication value.

Object identity, JSON serialization, or comparison of decoded clauses alone is insufficient. An implementation can index canonical bundle encodings by digest and confirm exact equality without changing the proof format.

### Renewal creates a new assertion version

A legitimate renewal should:

1. Create a new live assertion.
2. Produce and persist a new immutable bundle.
3. Update the source’s selected set.
4. Treat proofs carrying a retired version as requiring reconstruction.

It can be legitimate to select both the older and renewed versions temporarily, provided both remain eligible and the current source read explicitly selects both. That is a profile decision, not permission to accept an unselected cached version.

Withdrawal or a disqualifying lifecycle change must remove **every selected version containing the affected record**. A new timestamp cannot supply fresh author approval or upgrade a record’s submission generation.

### Per-read renewal can prevent any caller-built proof from succeeding

This is the clearest liveness failure:

1. The prover obtains `b1`.
2. It builds a proof carrying `b1`.
3. The receiver’s fresh read produces newly timestamped `b2`.
4. Exact membership rejects `b1`.
5. Retrying repeats the same mismatch.

The protocol needs stable assertion versions, or proof construction against evidence already acquired by the receiver. A richer `supply()` method does not solve this unless its profile specifies compatible assertion-version behavior.

### Whole-bundle membership has a second form of coupling

The brief correctly identifies the case where a proof uses route B but still carries unused route A. Withdrawing A invalidates that proof until it is rebuilt. research(20261021-041852)

There is also coupling **inside a bundle**.

Suppose one signed bundle contains an Alice-authored clause and a Zoe-authored clause. Alice’s submission becomes ineligible; Zoe’s remains eligible. Keeping the bundle selected to preserve Zoe also keeps Alice’s clause available.

The source must deselect the old bundle and, if useful, issue a replacement containing the eligible remainder. A proof using only Zoe still needs the replacement bundle.

Smaller bundles, or bundles grouped by records likely to change eligibility together, reduce this disruption. That is a useful storage choice without changing the law or membership unit.

### The receiver sequence should remain explicit

Conceptually:

```text
Authenticate the actual request actor
Check that actor’s current account eligibility
Obtain the receiver-required current source outputs
Require every proof-carried bundle to match eligible selected evidence
Run the unchanged verifier on the actual actor, operation, and space
Execute the effect under the operation’s declared consistency policy
```

The verifier still receives encoded proof bytes. Its bundle authentication, law/layer checks, program reconstruction, exact-query checking, and limits remain necessary.

A provider response cannot replace proof verification. Successful proof search cannot replace provider applicability checking.

## 3. “Current” must state its consistency boundary

The brief correctly avoids claiming that separate source reads are atomic. I would strengthen this with a concrete counterexample, because the issue is more substantial than an ordinary delay before execution.

### Separately current reads can produce a proof whose grants never coexisted

Assume independently rooted supplier support throughout:

| Step | Event |
|---|---|
| 1 | Source X selects a grant from supported grantor G to Alice. The receiver reads X. |
| 2 | X withdraws that grant. |
| 3 | Source Y begins selecting Alice’s grant to Bob. Alice remains an active account but now lacks the necessary authority support. |
| 4 | The receiver reads Y. |
| 5 | The combined evidence contains G→Alice and Alice→Bob, so the frozen law can establish Bob’s authority. |

Both reads can be truthful current observations of their respective sources. Nevertheless, the two grants were never simultaneously selected.

This is not an error in the positive law. It is a consequence of the receiver’s evidence-selection policy.

A small source interface can support a policy that accepts a combination of individually current observations. It cannot imply a jointly current snapshot. **Do not assume the first consumer accepts that weaker guarantee merely because the interface is small.** Record the operation’s chosen guarantee explicitly.

### Distinguish three guarantees

1. **Source-local coherence.** One source returns a coherent selection within its declared scope.
2. **Cross-source coherence.** Several source outputs correspond to one compatible joint state.
3. **Validity at effect commit.** The required actor and evidence conditions still hold when the protected effect commits.

Each requires its own implementation support.

For pagination, a continuation token alone does not establish source-local coherence. Pages need to be pinned to a coherent selection, or the provider must report selection change and restart. Mixing pages from different revisions can manufacture the same kind of never-coexisting proof as the example above.

A descriptive revision also proves nothing by itself. If a protocol relies on it, the protocol must define which changes affect it, its scope, and how it is bound to the read or operation. Revisions from separate sources have no implied common ordering.

### The actor-status check has the same timing issue

The actor can be active when checked and disabled before the effect. Evidence can likewise be withdrawn after selection.

If the operation promises observation-time eligibility, document the relevant observations. If it promises eligibility at commit, use an operation-level transaction or commit protocol that actually binds those conditions to the effect. Merely checking again later leaves another interval after the last check.

These are consumer guarantees. They should not be silently encoded as an invented property of `read()`, the local verifier, or `assertedAt`.

The required outage behavior remains straightforward: **a required current read that cannot be completed must refuse under this profile.** Any alternate-provider policy must be explicitly configured and satisfy the same lifecycle obligations. A bounded-age fallback would be a different policy, as the brief already says.

## 4. Keep the identity encoding; sharpen lifecycle semantics

I would retain the proposed tuple:

```ts
new Tuple([
  atom("thesmos/issuer-subject/1"),
  encodeText(issuer),
  encodeText(subject),
]);
```

It gives a stable, versioned convention for naming an account principal while keeping authentication and mutable lifecycle separate.

The identity does not change merely because credentials rotate, account standing changes, the service endpoint moves, or a supplier key changes. A public-key atom remains a distinct principal, and grants to that key do not silently transfer to an issuer/subject tuple. Those separations are correct in the proposal. research(20261021-041852)

### Make the input restrictions executable

The helper should reject:

- Empty issuer or subject strings.
- Ill-formed Unicode strings, including unpaired surrogate code units.
- Incorrect native tuple shapes when decoding the profile.

Reject malformed strings before any lossy encoding could replace invalid code units. Otherwise a malformed input could collapse onto a valid replacement-character string.

Preserve valid scalar sequences exactly. In particular, composed and decomposed forms of an accented name remain different identities. Lowercasing, trimming, URL canonicalization, and Unicode normalization would introduce aliases contrary to the proposed profile.

Authentication must use a trusted issuer/subject binding compatible with that exact equality. The helper cannot authenticate a caller-supplied issuer string.

### Record the generation of the actual approval

Conceptually, provider storage needs something like:

```text
record ID
exact approved native attributed clause
authenticated author
authenticated submission generation
withdrawal state
```

This is internal record provenance, not a proposal to modify the proof wire.

The author and submission generation must come from the authenticated approval context. Neither should be accepted merely because the request supplied it.

A particularly important race is:

1. Alice approves a clause using authenticated generation `g7`.
2. Her account changes to `g8`.
3. A delayed handler persists the approval.
4. The handler copies the database’s current `g8` into the record.

That falsely turns a `g7` approval into a `g8` approval. Preserve the generation associated with the actual approval and validate it under the submission policy. Reject the stale submission, or retain it as ineligible history; do not upgrade it.

The exact-clause binding matters equally. Approval of one author, placement, head, body, and variable structure cannot justify later changing those elements.

### Define generation eligibility instead of merely naming it

A useful profile rule is:

```text
eligible(record, currentAuthorState) =
    record is approved
    AND record is not withdrawn
    AND current standing permits use
    AND record.submissionGeneration is currently admissible
```

For a strict profile, “currently admissible” can mean equality with the current submission generation.

However, the document does not establish whether every credential change should retire previous approvals. That is a concrete policy decision. Define which transitions advance the relevant generation and what those transitions invalidate; do not accidentally make routine credential bookkeeping the authority lifecycle.

Three transitions must remain distinct:

| Transition | Consequence |
|---|---|
| A required authority-support grant disappears | The authored clause may stop counting because its guard cannot be proved |
| An author becomes ineligible under standing/generation policy | The affected records must leave current selection under that profile |
| A record is withdrawn | That record leaves the source’s selected set |

Restoring authority support may legitimately make a still-selected authored clause useful again. That is consistent with the positive law.

Re-enabling an account is different. If the generation transition was intended to retire old approvals, a source must not republish them merely because the account is active again.

Similarly, do not cascade-delete Bob’s authored outgoing grant merely because Alice’s supporting route to Bob disappears. Bob may have another valid incoming authority route. The frozen author guard should resolve that question.

### Recovery must preserve lifecycle state as well as subject assignments

The strongest operational failure is restoring an old database backup.

A restore can preserve subject identifiers perfectly while losing withdrawal records or rolling generations backward. It can therefore resurrect approvals that were intentionally retired.

The continuity obligation should cover:

- Subject assignments and non-reassignment.
- Relevant generation state.
- Withdrawal state.
- The authenticated provenance needed to interpret stored approvals.

Endpoint migration and supplier-key rotation can preserve account identity when this namespace and lifecycle state continue. A genuinely new database lineage needs a fresh issuer namespace.

A replacement supplier key still needs ordinary supported supplier authority. An already supported non-root grantor can confer it; none of this requires bringing the root online for every change.

## 5. Conformance should test three separate decisions

The acceptance suite should distinguish:

1. **Request eligibility:** is this authenticated actor eligible under the service’s current account policy?
2. **Evidence applicability:** are all proof-carried bundles selected under the receiver’s profile?
3. **Native authorization:** does the unchanged verifier establish the actual query?

Success at one layer must never stand in for another.

Use the synthetic Alice, Bob, and Carol principals, a supported non-root grantor G, separately rooted supplier support, two alternative authority routes, and a variable rule with a cross-space premise. Encode all of these through the actual native SDK representations.

### Authority and native-clause preservation

| Case | Expected result |
|---|---|
| G grants Alice; Alice grants Bob; Bob grants Carol; independent supplier support exists | Carol’s exact query succeeds while the root is operationally offline |
| Supplier has `supply_facts`, but the author lacks authority for the instantiated conclusion | That conclusion does not count |
| Author support exists, but required supplier support is absent | That supplied route fails |
| Accounts authenticates the user’s approval and signs its supplied output; user has no personal signing key | Otherwise supported proof succeeds |
| An authorized ancestor supplier supplies a descendant placement | Accepted; a routing prefix does not cancel another authorized supplier route |
| Author or supplier appointments form an unsupported circular chain | No finite rooted authorization is established |
| A variable rule retains its positive body and cross-space premise | Intended instantiations work; removing the premise breaks that route |
| Placement, author, body, variables, timestamp, or other authenticated content is altered | Authentication or structural checking rejects |
| Proof targets another actor, operation, or space | Receiver’s actual query prevents acceptance |

Do not reject every program containing recursion or a cycle. The relevant distinction is whether a finite rooted proof supports the conclusion.

### Current selection and lifecycle

| Case | Expected result |
|---|---|
| A required grant is withdrawn | Old proof fails current membership or loses required support, as appropriate |
| Route A is withdrawn but independent B survives | A newly built proof using B succeeds |
| That B proof still carries an unused withdrawn A bundle | Whole-bundle membership rejects until it is rebuilt |
| A mixed-author bundle contains one newly ineligible record | Old bundle is deselected; eligible remainder requires a replacement |
| Old `assertedAt`, but the required current read explicitly selects the exact bundle | Age alone does not reject under this profile |
| Renewal changes payload or authentication | New bundle identity; no automatic match to the retired version |
| Old-generation approval is delayed, re-enabled, or renewed | It is not silently relabeled as a current-generation approval |
| A mirror returns an old copy after the governing selection has changed | It must establish applicability under its configured responsibility or fail the profile |
| A required provider or lifecycle dependency is unavailable | Refusal; no silent use of cached active status or a bounded-age fallback |

The lifecycle tests should apply to supplier appointments, conditional rules, intermediate grants, and cross-space support—not just the final direct grant.

### Consistency, budgets, and unsuccessful search

| Case | Expected result |
|---|---|
| Selection changes during pagination | Pin a coherent selection, restart, or report change; do not claim a coherent snapshot from mixed pages |
| Separately current reads produce the never-coexisting-grants example | Behavior matches the explicitly documented cross-source guarantee |
| Actor status or selected evidence changes before effect | Behavior matches the operation’s observation-time or commit-time guarantee |
| Source output is partial or truncated | Do not label it a completed snapshot beyond its declared coverage |
| Unused bundles exceed applicable proof limits | They still consume the documented budgets |
| Client search finds a derivation using unauthenticated candidates | Receiver authentication remains decisive |
| Search is exhausted | Report the outcome relative to the supplied evidence and search scope |
| Search is incomplete because of limits or interruption | Preserve that distinction; do not infer universal prohibition |

The brief’s limits and current inclusion of all input bundles make candidate selection an immediate integration concern, not merely a future optimization. research(20261021-041852)

Diagnostics should also preserve these distinctions. “Actor ineligible,” “required evidence unavailable,” “evidence changed,” “verification rejected,” and “search incomplete” can all refuse an operation, but they do not mean the same thing. In particular, an outage or failed search must not become the claim that no authorized route exists anywhere.

## 6. The simplest useful designs beyond the proposal

Three implementation choices deserve consideration without creating another public contract.

### A live selection manifest over immutable bundle storage

Separate storage of immutable signed bundles from the current selection of those bundles.

A source can perform a fresh authenticated read of its selected bundle identifiers, then resolve the immutable objects from storage or a cache. The adapter still returns the existing `SpaceFactsSnapshot` shape.

Currentness belongs to the live selection decision. Object retrieval need not manufacture a new assertion timestamp.

This naturally supports stable proof membership, historical retention, and explicit withdrawal. It also makes clear why an object-store cache cannot, by itself, declare an old bundle current.

### Positive selection scoped to the submitted proof

For verification, the receiver does not need to enumerate every selected clause in a space. It needs to establish current selection of the exact bounded set of bundles carried by the submitted proof.

If full snapshots become expensive, a selector over those bundle identifiers is a useful first extension. Broader selectors can serve candidate discovery through the same provider operation.

This is a concrete reason to evolve toward `supply()` later. It does not require a separate public `checkCurrent()` interface, nor any claim of globally complete evidence discovery.

### Receiver-owned proof construction

For a first service that can afford bounded search, the simplest composition may be:

1. Authenticate and check the request actor.
2. Read current selected evidence.
3. Construct the proof from that acquisition.
4. Verify the resulting certificate.
5. Execute under the declared operation policy.

This avoids the mismatch between a caller’s earlier evidence acquisition and the receiver’s newly issued bundle versions.

It does not eliminate the read-to-effect race, and the receiver still needs to respect search and proof budgets. Because the current prover carries all provided bundles, it should receive an appropriate bounded candidate set rather than an arbitrarily large snapshot.

### How I would settle the snapshot-versus-supply decision

| First consumer’s concrete need | Appropriate design |
|---|---|
| Fixed bounded scope and one live profile | Configuration-bound `read()` |
| Existing transport already exposes richer supply requests | Bind it behind the same `read()` seam |
| Dynamic selectors, disclosure rules, or pagination are actually required | Generalize the same seam with explicit profile semantics |
| Current lifecycle requirements cannot be met | Explicit inability to satisfy the profile |
| Operation needs joint or commit-time validity | Add the necessary consumer coordination protocol; neither API shape supplies it automatically |

I would approve the proposed direction with four additions to the specification: **selection responsibility, exact generation eligibility, whole-bundle replacement behavior, and explicit consistency guarantees.** The remaining work is to make those guarantees testable in the first consumer. The supplied brief gives no reason to change the authority law, require personal signing keys, add a publication privilege, or put mutable lifecycle state into identity.