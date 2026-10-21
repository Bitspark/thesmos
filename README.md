# thesmos

**The law of who may assert what, in which space.**

This is a fresh implementation of the frozen Spaces authority model. It starts
with one TypeScript SDK, declarative Logos law and Ontos evidence. The prior
implementation is preserved separately as private `Bitspark/thesmos-legacy`.
This repository contains none of its history or runtime compatibility paths.

## Status

Source preview, Node 24. The checker, asserter layer, optional Archon adapter
and Logos proof client are implemented. **An anonymous npm install is not yet
available:** the required `@bitspark/logos-contract@0.24.0` and optional client
dependency `@bitspark/logos-kernel@0.24.0` are currently private GitHub packages.
This source preview is not a public npm release. Other dependencies are public.

The [v1.0.0-preview.2 release](https://github.com/Bitspark/thesmos/releases/tag/v1.0.0-preview.2)
provides the qualified archive, exact CI evidence and SHA-256 checksum, including
the optional `/identity` entry. Its complete gate passed 95 tests and preserved
all eight frozen artifacts. Consumers need the stated Logos access; release
archives bundle no private dependency code. The `/client` and `/archon` entries
still require their optional peers at the versions below.

With existing GitHub Packages read access, install the committed lockfile and
run the complete gate:

```sh
npm ci --allow-remote=all
npm run check
```

Keep the existing credential in the normal user or CI secret store. Do not add
credentials to this repository. The lockfile selects exact Logos artifacts;
Ontos stays on 0.13.0 to share the same Value implementation as Logos 0.24.0.

## Receiver and caller

```ts
import { createSpacesVerifier } from "@bitspark/thesmos";
import { authenticateArchon } from "@bitspark/thesmos/archon";

const verifier = createSpacesVerifier({ root: configuredRoot, authenticate: authenticateArchon });
const decision = verifier.verify({
  query: { actor: authenticatedActor, space: operationSpace, statement: operationStatement },
  proof: callerProof,
});
if (!decision.permitted) return; // The service performs its operation only after acceptance.
```

The service fixes the root, actor and operation. The proof cannot choose them.
The optional caller entry constructs a finite proof using Logos:

```ts
import { prove } from "@bitspark/thesmos/client";
const proof = await prove({ root: configuredRoot, query, bundles });
```

When no proof is returned, `prove` throws a `ProofSearchError`. Its `reason` is
`exhausted` when the search finished without deriving the query, and
`not_completed` for any other outcome: a `limits` bound, cancellation, an
engine failure, a request Logos refused, or the search memory ceiling. That
ceiling is 256 MiB by default; `memoryLimitPages` raises it to at most 1 GiB
(16384 pages); a value outside that range throws a `RangeError` from Logos rather
than a `ProofSearchError`. Neither reason proves the operation
is prohibited.

On `main` after preview.2, a returned proof carries only the bundles its
derivation uses, each unchanged. The immutable preview.2 archive predates this
change and carries all supplied bundles.
Pruning works per bundle: a used bundle is disclosed in full, because it is
signed as one payload. An asserter that needs finer disclosure, or wants a
change to one record to leave other proofs intact, should keep records that
change together in separate bundles. Every bundle given to `prove` still counts
toward the 2048-clause input limit, so a caller should preselect candidates.

Measured envelope (`core/ts/test/shapes.test.ts`, on a development workstation):

| Shape | Search | Check | Proof | Nodes / depth |
| --- | --- | --- | --- | --- |
| A workload acting for a person via a membership rule, a confirmation and a delegated asserter's workload fact (three suppliers, two variable rules) | about 0.6 s | about 0.1 s | 28 KB | 62 / 11 |
| The same request nested inside a run start whose rule binds the inner actor | about 0.7 s | about 0.1 s | 38 KB | 77 / 13 |

These are far inside the verifier's limits (2048 nodes, depth 256, 1 MiB). A nested rule that leaves the inner request's actor unbound (`authorized(W, Inner, S)` with `W` free) did not complete in a one-off observation: after about 36 s Logos returned `not_completed` (not pinned by a test). Bind the actor through the inner request's own terms.

The receiver imports no search engine. The client requires Logos kernel, and
the Archon adapter requires `@bitspark/archon@0.15.0`; both are optional peers.
Custom authentication can implement the small callback instead. The adapter
uses Archon's Ed25519ph context `thesmos/space-facts/v1`, exact Ontos payload
bytes, public-key atoms and signature atoms. It adds no authority policy.

Run `npm run build && npm run example`. The
[document service](examples/document-service.ts) carries root → team → docs
asserter outputs and Alice's grant to Bob. The receiver verifies the chain
and the exact rename; changed actor or title is denied without a state change.
The [device example](examples/device-service.ts) uses the same law for an
unrelated operation. All example keys and identities are synthetic.

The [account example](examples/account-principals.ts) uses issuer-qualified
people without personal keys: a non-root grantor establishes Alice's authority,
Alice delegates to Bob, and Bob's variable conditional rule delegates to Carol.
Separate suppliers support both the grants and the condition. See the
[identity integration profile](docs/identity.md) for authentication boundaries,
syntax-only record inspection and the optional `/identity` entry.
The [evidence-selection profile](docs/evidence-selection.md) explains how a
receiver can acquire applicable bundles without adding policy to the law.

## Layout and boundaries

| Location | Responsibility |
| --- | --- |
| [law/](law/common-law.logos) | Frozen common law and compiled Ontos data; separate asserter template |
| [core/ts/src/](core/ts/src/index.ts) | Local verifier; `/client` search; `/archon` authentication adapter; `/identity` issuer/subject profile |
| [conformance/](conformance/frozen.json) | Frozen artifact pins; original corpus is `law/conformance.ontos` |
| [core/ts/test/](core/ts/test/sdk.test.ts) | Core, asserter, mutation and client tests |
| [docs/model.md](docs/model.md) | Model, trusted facts and implementation boundaries |
| [docs/foundations.md](docs/foundations.md) | How the public Constellation contracts are used |
| [docs/runtime.md](docs/runtime.md) | Decision record for the shared runtime: placement, result contract, admitted profile |

There is no store, server, global lease, expiry default, role registry, separate
publication permission or execution engine in the SDK. A timestamp is signed
evidence; freshness remains separately modeled policy. The receiver owns the
meaning and execution of its operation. Accounts can provide identity and
generic confirmation without becoming a central permission endpoint.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
