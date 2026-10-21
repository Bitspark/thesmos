# Selecting applicable evidence

This is a consumer integration profile, outside the frozen law. The SDK already
checks authenticated `SpaceFactsBundle` values and complete native proofs. It
does not acquire evidence or decide which historical outputs apply now.

A receiver can configure an adapter that returns its selected bundles. The
first Accounts integration uses this boundary internally with the qualified
`v1.0.0-preview.2` archive. No public provider
interface, revision field, paging protocol or expiry rule is required by the
SDK. [Issue 7](https://github.com/Bitspark/thesmos/issues/7) retains that future
interface work until a concrete interoperable caller needs it.

## The receiving boundary

For the current-membership profile, the receiver:

1. Authenticates the actor and constructs the exact operation query.
2. Acquires a bounded selection from its configured, authenticated sources.
3. Requires every bundle carried by the proof to be selected, comparing the
   complete payload and canonical native authentication value.
4. Calls the existing verifier with its root and actual query before acting.

Source membership establishes applicability, not authority. Each included
supplier and author still needs the native support required by the unchanged
law. The receiver may construct the proof itself with `prove`; a caller-supplied
proof is also possible. Neither search failure nor unavailable evidence proves
that no authorized route exists.

Configuration must identify which source selects a supplier's mutable outputs.
For example, when Accounts withdraws one of its outputs, a mirror returning
the old signed bytes must not restore its membership. Another authorized
supplier's independently authenticated assertion can still provide a valid
alternative. This is source-selection policy, not supplier exclusivity in the
law or a global blacklist of clauses.

## Stable outputs and lifecycle

Persist the complete authenticated bundle. Repeated reads can return the same
bytes while the source changes which bundles it selects. Changing the signed
timestamp, payload or authentication creates a different bundle; fetching old
bytes does not make their assertion time new.

The current Accounts profile emits one immutable bundle per authored record.
Withdrawal deselects that record's output. If batching is introduced, removing
one record must deselect every affected whole-bundle version; a replacement
bundle can preserve the eligible remainder. Duplicate live records may support
identical bytes independently. A fresh authenticated authoring act can select
the same clause again without reviving the withdrawn record.

Authentication must bind the exact clause to the author's actual approval
context. A delayed approval from an earlier account generation cannot acquire
the generation current at persistence time. Recovery must preserve identity,
generation, withdrawal and authenticated provenance continuity. These are
service lifecycle obligations, not extra authority axioms. Losing one incoming
authority path does not require deleting all outgoing clauses: the law checks
the author's remaining support for each conclusion.

## Explicit limits

An adapter must state its acquisition/decode bounds and refuse an incomplete
selection rather than silently truncate it. A revision is useful only when the
consumer defines and checks its meaning. Source-local coherent reads do not
establish one atomic state across independent sources or validity at a later
effect. The current consumer documents its observation cut and local effect
fence; stronger guarantees require an operation-specific protocol.

The released `v1.0.0-preview.2` prover includes all supplied bundles. After one
is deselected, a proof carrying it fails membership even if another route could
justify the query. Reprove using the surviving selection. Later source
[PR17](https://github.com/Bitspark/thesmos/pull/17) prunes unused bundles on
`main`, retaining used bundles whole and unchanged. That source change is not
in the immutable preview.2 archive; consumer adoption needs a qualified release.

Qualification pairs successful full native chains with removed author,
supplier and conditional support; tests source replay, independent alternatives,
changed queries, lifecycle changes, retries and interrupted acquisition; and
verifies the receiving service's actual operation. A library test or signed
historical bundle alone does not qualify a live portal.

The [research disposition](../research-docs/0001-current-evidence-provider.md#applied)
records the evaluated advice and outstanding receiving validation. Identity
encoding is the separate [issuer/subject profile](identity.md). Neither profile
changes the frozen core or requires a personal signing key.
