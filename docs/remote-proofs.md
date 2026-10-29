# Remote proof production

A consumer can ask a configured provider to produce a native proof instead of running Logos
search itself. Accounts is the first intended provider. thesmos remains a library: it defines the
request, result and failure vocabulary, provides kernel-free codecs and an HTTP client adapter in
`@bitspark/thesmos/remote`, and provides a provider-side helper in `@bitspark/thesmos/client`.
Hosting, sessions, credentials, record selection, disclosure policy, workers and quotas belong to
the provider. This contract is a source preview; names and codes may change with review on
[issue 29](https://github.com/Bitspark/thesmos/issues/29).

## Trust

- **The provider is never trusted for authority.** A returned proof is checked by the receiver with
  `createSpacesVerifier`, under the receiver's own root and the actual request's query, before any
  effect. A provider result is not a permit.
- **Caller identity comes from authenticated transport.** The query's `actor` is a goal term.
  Disclosure of a provider's records is decided for the authenticated caller, never for the
  queried actor, and never because a product is registered.
- **Observations are descriptive.** A provider may report which source and position it read. That
  is no claim of currency at a later effect, atomicity across sources or acceptance.

## Request and result

| `ProofRequest` field | Meaning |
| --- | --- |
| `root` | The caller's configured root. The result is bound to it. |
| `query` | `{ actor, space, statement }`. |
| `bundles` | Signed bundles supplied by the caller, exact bytes. A request with only these must work. |
| `selection` | An opaque, provider-defined reference to records the provider selects. |
| `disclosureProofs` | Native proofs the caller presents for the provider's own disclosure checks. |
| `budget` | Hints: `deadlineMs`, `memoryBytes`, `searchNodes`. A provider may lower them, never raise them above its ceilings. |

A result is either the existing `spaces/proof/6` envelope, carrying only the bundles its
derivation uses, with descriptive `observations`, or a failure `{ code, detail? }`.

| Failure | Meaning |
| --- | --- |
| `exhausted` | The search finished over the selected evidence without a derivation. |
| `not_completed` | A limit, budget, deadline, the memory ceiling or cancellation stopped the search. |
| `disclosure_refused` | The authenticated caller may not see the requested selection. |
| `unauthenticated` | Caller authentication or audience failed. |
| `evidence_unavailable` | A required source, selection or record is unavailable, unknown or changed. |
| `invalid_request` | A malformed request, or supplied bundles that fail authentication. |
| `limit_exceeded` | A request, response or fixed bound is too large. |
| `provider_unavailable` | A transport failure, overload or unexpected provider error. |
| `invalid_response` | A malformed result, or a proof whose conclusion or root does not match the request. |

None of these means "prohibited". Caller cancellation rejects with the caller's own
`AbortSignal` reason.

## Wire

Requests and results are native Ontos bytes under `application/vnd.bitspark.spaces-proof+ontos`,
sent by `POST` to the configured endpoint. A provider answers every application outcome with this
media type at any HTTP status. The adapter maps a response without it by status: 401 and 403 to
`unauthenticated`, 413 to `limit_exceeded`, 400 and 422 to `invalid_request`, 429 and 5xx to
`provider_unavailable`, and anything else to `invalid_response`. Requests are bounded at 8 MiB
and responses at 2 MiB by default; decoding is bounded in depth, atom size and arity. Redirects
are refused.

## Using it

```ts
import { createSpacesVerifier } from "@bitspark/thesmos";
import { createHttpProofProvider } from "@bitspark/thesmos/remote";

const provider = createHttpProofProvider({
  endpoint: configuredProviderUrl,
  authenticate: ({ url, body, headers }) => signRequest(url, body, headers), // the caller's scheme
});
const { proof } = await provider.produce({ root: configuredRoot, query, bundles, selection, disclosureProofs });
const decision = createSpacesVerifier({ root: configuredRoot, authenticate }).verify({ query, proof });
```

`@bitspark/thesmos/remote` imports no Logos kernel, WASM, Archon or filesystem code; the package
gate checks its code and declarations and runs a consumer that has neither installed. The adapter
rejects a proof that does not conclude the requested query from the requested root before
returning it; that early check does not replace the receiver's verification.

A provider decodes requests with `decodeProofRequest`, performs its own caller authentication,
disclosure checks and selection, then calls `answerProofRequest(request, { bundles, authenticate,
observations, ceilings })` from `@bitspark/thesmos/client` and encodes its result with
`encodeProofResult`. `answerProofRequest` authenticates supplied bundles when asked, adds the
provider's selected bundles, maps the budget to Logos limits under the provider's ceilings and
maps search outcomes to the codes above. It makes no authority decision.

## Migrating from local production

`createLocalProofProvider` implements the same `ProofProvider` interface with Logos in the
current process. Code written against `ProofProvider` changes only how the provider is built:

```ts
// Before: local search in the consumer.
const proof = await prove({ root, query, bundles });
// After: the same request through a provider, local or remote.
const { proof } = await provider.produce({ root, query, bundles });
```

Keep the consumer's request mapping, current-evidence checks, verification and effect
enforcement unchanged. There is no automatic fallback from a remote provider to local search;
a consumer that wants one configures it explicitly.
