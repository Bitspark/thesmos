# thesmos

**The law of who may assert what, in which space.**

This is a fresh implementation of the frozen Spaces authority model. It starts
with one TypeScript SDK, declarative Logos law and Ontos evidence. The prior
implementation is preserved separately as private `Bitspark/thesmos-legacy`.
This repository contains none of its history or runtime compatibility paths.

## Status

Source preview, Node 24. The checker, asserter layer, optional Archon adapter
and Logos proof client are implemented. From preview.8, each release is published to
npm as `@bitspark/thesmos` and to crates.io and PyPI as `bitspark-thesmos` (preview.7 is
on npm and crates.io); a preview is a pre-release, `1.0.0rcN` on PyPI. The required `@bitspark/logos-contract@0.25.0` and Ontos
0.13.0 are public on npmjs.org. The optional client dependency
`@bitspark/logos-kernel@0.25.0` is still a private GitHub package.

The [v1.0.0-preview.8 release](https://github.com/Bitspark/thesmos/releases/tag/v1.0.0-preview.8)
is the first that the release workflow publishes to all three registries, with npm
provenance and PyPI attestations: `npm install @bitspark/thesmos`,
`bitspark-thesmos = "=1.0.0-preview.8"` from crates.io, and
`pip install --pre bitspark-thesmos` with wheels for Linux, macOS and Windows. Its
receivers, frozen law and proof format are unchanged from preview.7, which made every
receiver build without Logos access and added the Python receiver; preview.7's npm package
and crate are on the registries too. The Go module is tagged `core/go/v1.0.0-preview.8`,
and C/C++ builds from the `v1.0.0-preview.8` tag. Its complete gate passed 119 TypeScript
tests and every receiver's tests, and preserved all eight frozen artifacts. The `/client`
entry still requires the optional, private peer `@bitspark/logos-kernel@0.25.0`, and
`/archon` the public `@bitspark/archon@0.16.0`.

Install it with `npm install @bitspark/thesmos`, and `@bitspark/archon@0.16.0` for the
Archon adapter. To work on thesmos itself, with existing GitHub Packages read access,
install the committed lockfile and run the complete gate:

```sh
npm ci --allow-remote=all
npm run check
```

Keep the existing credential in the normal user or CI secret store. Do not add
credentials to this repository. The lockfile selects exact Logos artifacts;
Ontos stays on 0.13.0 to share the same Value implementation as Logos 0.25.0.

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

A proof-producing host may explicitly supply `search` to `prove`,
`answerProofRequest` or `createLocalProofProvider`. This function uses Logos's
existing `embedQuery` request/outcome contract; its default remains `embedQuery`.
This lets the host select a separately qualified native producer while keeping
the same frozen program, clause mapping, signed-bundle pruning and proof encoding.
No other implementation is tried if the selected producer fails. The host owns
its executable identity, process isolation and hard cancellation. Guest-specific
options such as `memoryLimitPages` must be supported or rejected explicitly by
that implementation. A remote caller cannot select the host's search function;
the remote wire and the consumer's independent verifier are unchanged.

From preview.3, a returned proof carries only the bundles its derivation uses,
each unchanged, and its `bundle/<i>/<j>` clause references are renumbered to the
kept bundles' positions. The immutable preview.1 and preview.2 archives carry all
supplied bundles.
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

A caller without Logos can instead ask a configured provider through
`@bitspark/thesmos/remote` (`createHttpProofProvider(...).produce(request)`), and
verify the returned proof locally exactly as above; see
[remote proof production](docs/remote-proofs.md).

The receiver imports no search engine. The client requires Logos kernel, and
the Archon adapter requires `@bitspark/archon@0.16.0`; both are optional peers.
Custom authentication can implement the small callback instead. The adapter
uses Archon's Ed25519ph context `thesmos/space-facts/v1`, exact Ontos payload
bytes, public-key atoms and signature atoms. It adds no authority policy.

### Go receiver

Go services verify the same proofs with `github.com/Bitspark/thesmos/core/go`, which
needs no Node runtime or WASM loader:

```go
import (
	thesmos "github.com/Bitspark/thesmos/core/go"
	"github.com/Bitspark/thesmos/core/go/archon"
)

verifier, err := thesmos.NewVerifier(configuredRoot, archon.Authenticate)
decision := verifier.Verify(thesmos.Query{Actor: actor, Space: space, Statement: statement}, callerProof)
if !decision.Permitted {
	return // the service performs its operation only after acceptance
}
```

It is the receiver only: it checks supplied proofs and runs no search. Like the
TypeScript verifier, it hand-writes no authority rule. It embeds the frozen law
and layer as data and leaves the decision to Logos's Go checker
(`github.com/Bitspark/logos-contract/contract/go` v0.25.0), with Ontos v0.13.0 values and
archon's Go core v0.16.0 for the same `thesmos/space-facts/v1` signatures. Its tests
run the frozen corpus `law/conformance.ontos` and an Archon-signed proof made by
the TypeScript SDK, which the TypeScript suite checks too, so both receivers accept
the same bytes. Go module versions are tagged `core/go/v<version>` with the same
version as the npm package. Every module it requires is public.

### Rust receiver

Rust programs verify the same proofs with the crate `bitspark-thesmos` (library
`thesmos`) in `core/rs`, again with no Node runtime or WASM loader:

```toml
[dependencies]
thesmos = { package = "bitspark-thesmos", version = "=<version>" }
```

From crates.io, or as a git dependency at the tag `v<version>`.

```rust
use thesmos::{archon, Query, Verifier};

let verifier = Verifier::new(configured_root, archon::authenticate);
let decision = verifier.verify(&Query { actor, space, statement }, &caller_proof);
if !decision.permitted {
    return; // the service performs its operation only after acceptance
}
```

It is the same receiver as the Go module: no search, no hand-written authority rule,
and the decision left to Logos's Rust checker (`logos-contract` 0.25.0 from crates.io),
with Ontos 0.13.0 values and `bitspark-archon-core` 0.16.0. The Archon adapter is the
default feature `archon`; with `default-features = false` you supply your own
`Fn(&Bundle, &Value) -> bool + Send + Sync + 'static`. It needs Rust 1.96 or later.
Its tests run `law/conformance.ontos` and the same TypeScript-signed Archon proof
as Go, on Windows, Linux and macOS. Its dependencies all come from crates.io.

### C and C++ receiver

C and C++ programs verify the same proofs through `core/cpp`, the Rust receiver behind
a C ABI (`thesmos/thesmos.h`) with a header-only C++20 wrapper (`thesmos/thesmos.hpp`).
CMake builds it from source with Cargo through Corrosion:

```cmake
add_subdirectory(thesmos/core/cpp)  # or FetchContent with SOURCE_SUBDIR core/cpp
target_link_libraries(service PRIVATE thesmos::thesmos)
```

```cpp
#include <thesmos/thesmos.hpp>

const auto verifier = thesmos::Verifier::archon(configured_root);
const auto decision = verifier.verify({actor, space, statement}, caller_proof);
if (!decision.permitted) {
  return;  // the service performs its operation only after acceptance
}
```

It adds nothing to the Rust receiver: no decoding, rule or checking of its own, so it
decides exactly as `core/rs` does. Values are opaque handles to Ontos values, built with
`thesmos::path`, `fact`, `symbol`, `Value::atom` and friends or decoded from canonical
bytes. `thesmos::Verifier(root, callback)` takes your own authentication adapter: `false`
denies as `authentication-failed`, and an exception it throws denies as `invalid-proof`, as a
failing adapter does in every other receiver. No exception or panic crosses the C boundary.
Its tests run `law/conformance.ontos` through a C++ adapter and the TypeScript-signed Archon proof
through the built-in one. Building needs only the Rust crate's public dependencies.

### Python receiver

Python programs verify the same proofs with the module `thesmos`, the Rust receiver
behind PyO3, from the package `bitspark-thesmos` in `core/py` (CPython 3.10 and later):

```python
import thesmos

verifier = thesmos.Verifier.archon(configured_root)  # or Verifier(root, authenticate)
decision = verifier.verify(thesmos.Query(actor, space, statement), caller_proof)
if not decision.permitted:
    return  # the service performs its operation only after acceptance
```

It adds nothing to the Rust receiver, so it decides exactly as `core/rs` does. Values
are `thesmos.Value`, canonical Ontos values with `encode()` and `Value.decode(...)`,
built with `thesmos.path`, `fact`, `symbol`, `list` and `authorization`.
`Verifier(root, authenticate)` takes your own adapter: only the bool `True`
authenticates, any other result is `authentication-failed`, and an exception it raises
is `invalid-proof`, as in every receiver; KeyboardInterrupt and SystemExit propagate. `Verifier.archon(root)` uses
the built-in Archon adapter without calling back into Python. Verification releases the
GIL. Its tests run `law/conformance.ontos` and the TypeScript-signed Archon proof.

Install it from PyPI with `pip install --pre bitspark-thesmos`, or name a version:
`1.0.0rcN` is the preview `1.0.0-preview.N`. PyPI has abi3 wheels for CPython 3.10 and
later on Linux (x86_64 and aarch64, manylinux2014), macOS (universal2) and Windows (x64),
and an sdist that builds elsewhere with Rust 1.96. From source:
`pip install "git+https://github.com/Bitspark/thesmos@v<version>#subdirectory=core/py"`.

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

The complete remote SDK workflow also exports deterministic 4/24/32/64/128-hop
inputs for [the retained capacity case](https://github.com/Bitspark/thesmos/issues/28).
Its `thesmos-proof-capacity-inputs-<revision>` artifact binds every file to the
checked source and a SHA-256 digest. The files contain the existing clause-codec
values for rules, facts and goal, plus the complete remote proof request. Facts
and the goal use zero-body clauses as containers for their head terms. All
synthetic timestamps are fixed; these are structural reproductions of the
original fixture, not its historical captured bytes. Exporting inputs performs
no search and establishes no native capacity result. The fixture sizes are
measurement cases, not delegation limits.

| Location | Responsibility |
| --- | --- |
| [law/](law/common-law.logos) | Frozen common law and compiled Ontos data; separate asserter template. Embedded into the library at build time, so the root, `/identity` and `/remote` read no files at runtime |
| [core/go/](core/go/verifier.go) | Go receiver: the same verification over Logos's Go checker; `archon` authentication adapter; a committed byte copy of `law/` |
| [core/rs/](core/rs/src/lib.rs) | Rust receiver: the same verification over Logos's Rust checker; `archon` feature; a committed byte copy of `law/` |
| [core/cpp/](core/cpp/include/thesmos/thesmos.hpp) | C and C++ receiver: `core/rs` behind a C ABI (`thesmos.h`, generated by cbindgen) with a C++20 wrapper; CMake through Corrosion |
| [core/py/](core/py/src/lib.rs) | Python receiver: `core/rs` behind PyO3 as the module `thesmos`, with type stubs; built by maturin |
| [core/ts/src/](core/ts/src/index.ts) | Local verifier; `/client` search; `/archon` authentication adapter; `/identity` issuer/subject profile; `/remote` proof-provider contract and HTTP adapter |
| [conformance/](conformance/frozen.json) | Frozen artifact pins; original corpus is `law/conformance.ontos` |
| [core/ts/test/](core/ts/test/sdk.test.ts) | Core, asserter, mutation and client tests |
| [docs/languages.md](docs/languages.md) | What each language offers, linked to the code that implements it |
| [docs/model.md](docs/model.md) | Model, trusted facts and implementation boundaries |
| [docs/foundations.md](docs/foundations.md) | How the public Constellation contracts are used |
| [docs/runtime.md](docs/runtime.md) | Decision record for the shared runtime: placement, result contract, admitted profile |
| [docs/remote-proofs.md](docs/remote-proofs.md) | Remote proof production: contract, wire, failures and migration from local `prove` |

There is no store, server, global lease, expiry default, role registry, separate
publication permission or execution engine in the SDK. A timestamp is signed
evidence; freshness remains separately modeled policy. The receiver owns the
meaning and execution of its operation. Accounts can provide identity and
generic confirmation without becoming a central permission endpoint.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
