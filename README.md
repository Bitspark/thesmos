# thesmos

**The law of who may assert what, in which space.**

This is a fresh implementation of the frozen Spaces authority model. It starts
with one TypeScript SDK, declarative Logos law and Ontos evidence. The prior
implementation is preserved separately as private `Bitspark/thesmos-legacy`.
This repository contains none of its history or runtime compatibility paths.

## Status

Source preview, Node 24. The checker, asserter layer, optional Archon adapter
and Logos proof client are implemented. **An anonymous npm install is not yet
available:** the required `@bitspark/logos-contract@0.23.0` and optional client
dependency `@bitspark/logos-kernel@0.23.0` are currently private GitHub packages.
This source preview is not a public npm release. Other dependencies are public.

Source version `1.0.0-preview.2` is being qualified. A release archive is usable
only once it is attached to the corresponding GitHub release with its exact
CI evidence and SHA-256 checksum. The existing
[v1.0.0-preview.1 release](https://github.com/Bitspark/thesmos/releases/tag/v1.0.0-preview.1)
does not include `/identity`. Consumers need the stated Logos access; release
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
Ontos stays on 0.13.0 to share the same Value implementation as Logos 0.23.0.

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
engine failure, a request Logos refused, or Logos 0.23.0's fixed 256 MiB search
memory, which no request field raises yet. Neither reason proves the operation
is prohibited.

A returned proof carries only the bundles its derivation uses, each unchanged.
Pruning works per bundle: a used bundle is disclosed in full, because it is
signed as one payload. An asserter that needs finer disclosure, or wants a
change to one record to leave other proofs intact, should keep records that
change together in separate bundles. Every bundle given to `prove` still counts
toward the 2048-clause input limit, so a caller should preselect candidates.

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

## Layout and boundaries

| Location | Responsibility |
| --- | --- |
| [law/](law/common-law.logos) | Frozen common law and compiled Ontos data; separate asserter template |
| [core/ts/src/](core/ts/src/index.ts) | Local verifier; `/client` search; `/archon` authentication adapter; `/identity` issuer/subject profile |
| [conformance/](conformance/frozen.json) | Frozen artifact pins; original corpus is `law/conformance.ontos` |
| [core/ts/test/](core/ts/test/sdk.test.ts) | Core, asserter, mutation and client tests |
| [docs/model.md](docs/model.md) | Model, trusted facts and implementation boundaries |
| [docs/foundations.md](docs/foundations.md) | How the public Constellation contracts are used |

There is no store, server, global lease, expiry default, role registry, separate
publication permission or execution engine in the SDK. A timestamp is signed
evidence; freshness remains separately modeled policy. The receiver owns the
meaning and execution of its operation. Accounts can provide identity and
generic confirmation without becoming a central permission endpoint.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
