# Remote proof production

A consumer can ask a configured provider to produce a native proof instead of running Logos
search itself. Accounts is the first intended provider. thesmos remains a library: it defines the
request, result and failure vocabulary, provides kernel-free codecs and an HTTP client adapter in
`@bitspark/thesmos/remote`, and provides a provider-side helper in `@bitspark/thesmos/client`.
Hosting, sessions, credentials, record selection, disclosure policy, workers and quotas belong to
the provider. This contract is a source preview; names and codes may change with review on
[issue 29](https://github.com/Bitspark/thesmos/issues/29).

## Trust

- **Proof production adds no trust in the producer's answer.** The existing trust in authenticated
  suppliers for their attribution and supplied facts remains. The receiver checks the derivation
  and its selected evidence with `createSpacesVerifier`, under its own root and the actual
  request's query, before any effect. A provider result is not a permit. The checker can reject an
  invalid derivation; it cannot independently establish that a trusted supplier reported truthful
  attribution or state.
- **Caller identity comes from authenticated transport.** The query's `actor` is a goal term.
  Disclosure of a provider's records is decided for the authenticated caller, never for the
  queried actor, and never because a product is registered.
- **The request's `root` is an input to the computation, not a trust anchor for disclosure.** A
  provider decides disclosure under its own configured root and current control evidence. A
  caller may compute over its own evidence under its own root; that never discloses the
  provider's records.
- **Observations describe the provider's selected evidence only.** They name which source and
  position were read. They make no claim of currency at a later effect, atomicity across sources
  or acceptance, and say nothing about bundles the caller supplied.

## Request and result

| `ProofRequest` field | Meaning |
| --- | --- |
| `root` | The caller's configured root for the computation. The result is bound to it. |
| `query` | `{ actor, space, statement }`. |
| `bundles` | Signed bundles supplied by the caller, exact bytes. A request with only these must work; it computes over the supplied inputs and asserts nothing about their currency. |
| `selection` | An opaque, provider-defined reference to records the provider selects, for example a bounded set of exact placements. |
| `disclosureProofs` | Native proofs the caller presents for the provider's own disclosure checks, for example `authorized(caller, read_records, placement)` for each selected placement. A provider profile may instead carry each proof inside its own `selection` value and require this field to be empty; one association, never two. |
| `budget` | Hints: `deadlineMs`, `memoryBytes`, `searchNodes`. `deadlineMs` is a duration counted by the provider from receiving the request, queue time included. A provider may lower any hint, never raises one above its ceilings and never increases a lower requested value. |

A result is either the existing `spaces/proof/6` envelope, carrying only the bundles its
derivation uses, with descriptive `observations`, or a failure `{ code, detail? }`.

| Failure | Meaning |
| --- | --- |
| `exhausted` | The search finished over the selected evidence without a derivation. |
| `not_completed` | A limit, budget, deadline, the memory ceiling or cancellation stopped the search. |
| `disclosure_refused` | The authenticated caller may not see the requested selection. |
| `unauthenticated` | Caller authentication or audience failed. |
| `evidence_unavailable` | A required source, selection or record is unavailable or unknown. |
| `evidence_changed` | The selection, its source or the caller's disclosure authority changed during the search; no selected proof material is released. |
| `invalid_request` | A malformed request, or supplied bundles that fail the provider's authentication. |
| `limit_exceeded` | A request, response or fixed bound is too large. |
| `provider_refused` | The provider or an intermediary refused without a typed reason. |
| `provider_unavailable` | A transport failure, overload or unexpected provider error. |
| `invalid_response` | A malformed result, or a proof whose conclusion or root does not match the request. |

None of these means "prohibited". Caller cancellation rejects with the caller's own
`AbortSignal` reason.

## Wire

Requests and results are native Ontos bytes under `application/vnd.bitspark.spaces-proof+ontos`,
sent by `POST` to the configured endpoint. A provider answers every application outcome with this
media type at any HTTP status. The adapter maps a response without it by status, claiming no
more than the status shows: 401 to `unauthenticated`, 403 to `provider_refused`, 413 to
`limit_exceeded`, 400 and 422 to `invalid_request`, 429 and 5xx to `provider_unavailable`, and
anything else to `invalid_response`. Requests are bounded at 1 MiB by default, matching the first
provider's native request reader; raise the limit only together with the provider's reader,
authentication, ingress and decoder. Responses are bounded at 2 MiB. Decoding is bounded in
depth, atom size and arity.

The adapter refuses redirects and never retries, and bounds its own wait with `timeoutMs`
(default 60,000 ms): on expiry it stops waiting with `provider_unavailable`, distinct from the
caller's own cancellation, while the provider still owns its worker. A caller that requests a
longer `deadlineMs` sets a correspondingly longer `timeoutMs`; both are at most 2,147,483,647 ms. Its `authenticate` hook receives the exact
method, target, headers (with `content-type` already set) and body; a signature should bind all
of them. Each `produce` call authenticates afresh, so a caller's retry carries a new replay nonce.

## Using it

```ts
import { createSpacesVerifier } from "@bitspark/thesmos";
import { createHttpProofProvider } from "@bitspark/thesmos/remote";

const provider = createHttpProofProvider({
  endpoint: configuredProviderUrl,
  authenticate: ({ method, url, body, headers }) => signRequest(method, url, body, headers), // the caller's scheme
});
const { proof } = await provider.produce({ root: configuredRoot, query, bundles, selection, disclosureProofs });
const decision = createSpacesVerifier({ root: configuredRoot, authenticate }).verify({ query, proof });
```

`@bitspark/thesmos/remote` imports no Logos kernel, WASM, Archon or filesystem code; the package
gate checks its code and declarations and runs a consumer that has neither installed. The adapter
rejects a proof that does not conclude the requested query from the requested root before
returning it. That bounded early check is not a second authority checker and does not replace the
receiver's verification or its own current-evidence requirements.

## Providing it

A provider decodes requests with `decodeProofRequest`, authenticates the caller from transport,
performs its own disclosure checks under its own root and selects its records. It then calls
`answerProofRequest` from `@bitspark/thesmos/client` and encodes the result with
`encodeProofResult`:

```ts
const result = await answerProofRequest(request, {
  authenticate: authenticateArchon,     // required: a function, or null to skip explicitly
  bundles: selectedBundles,             // the provider's current selection, added to supplied bundles
  observations: () => finalPositions(), // selected evidence only; a function runs after revalidate
  ceilings: { deadlineMs, searchNodes, memoryBytes },
  elapsedMs: sinceHandlerEntryMs,       // everything since receipt: body, authentication, selection, queue
  revalidate: () => selectionStillHolds(), // checked before releasing selected proof material
  signal,                               // cooperative cancellation of the search
});
```

`answerProofRequest` authenticates every supplied bundle with the given function and answers
`invalid_request` for any it does not accept; it requires an explicit `authenticate`, function or
`null`, rather than a default. A malformed supplied bundle is the caller's `invalid_request`
with fixed, safe detail; a fault in the provider's own selected evidence or in the engine is
thrown for the provider to report, never blamed on the caller. Observations are returned only
when the proof carries at least one of the provider's selected bundles. A supplied copy of a bundle the provider no longer selects remains
the caller's input and is never reported as part of the provider's selection. When the proof
uses selected evidence, `revalidate` runs before release: `false` gives `evidence_changed` and
`"evidence_unavailable"` (the re-read failed) gives that code; neither releases a proof. A proof
over the protocol's byte limit is `limit_exceeded`. `elapsedMs` must be finite and non-negative;
the remaining budget is floored to whole milliseconds, which counts a fractional elapsed
reading up, never granting time already spent. Budget hints and provider ceilings must be
whole, non-negative numbers: a caller's malformed hint is `invalid_request`, a provider's is
thrown.
Aborting the client's wait or the helper's `signal` is cooperative; enforcing worker deadlines,
memory limits, termination and cleanup is the provider's responsibility. The helper makes no
authority decision.

## Provider profiles

The SDK fixes the request, result, failure and wire shapes; each provider fixes a profile inside
them: its endpoint and audience, its `selection` value and how disclosure proofs are associated
with it, its observation values, its budget ceilings and its body bounds. thesmos interprets none
of these. The first profile, Accounts', carries exact `(space, disclosureProof)` pairs inside a
tagged selection value, requires `disclosureProofs` to be empty, reports one observation for its
record selection and one for its control source, and returns `evidence_changed` when either
changes during a search. A consumer configures the adapter's `maxRequestBytes` and `timeoutMs` for
the provider it calls; the 1 MiB default stays until a provider's whole request path supports
more.

## Migrating from local production

`createLocalProofProvider` implements the same `ProofProvider` interface with Logos in the
current process; it takes the helper's options except the per-request `signal` and `elapsedMs`. Code written against `ProofProvider` changes only how the provider is built:

```ts
// Before: local search in the consumer.
const proof = await prove({ root, query, bundles });
// After: the same request through a provider, local or remote.
const { proof } = await provider.produce({ root, query, bundles });
```

Keep the consumer's request mapping, current-evidence checks, verification and effect
enforcement unchanged. There is no automatic fallback from a remote provider to local search;
a consumer that wants one configures it explicitly.
