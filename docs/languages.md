# Languages

thesmos verifies Spaces proofs in five languages: TypeScript, Go, Rust, C/C++ and Python.

- **Checking proofs:** all five do it with the same frozen law, and CI requires them to decide alike. The one gap is decoding a space-facts payload, which C/C++ lacks.
- **Producing proofs:** TypeScript only.

Each table cell links to the code that implements it. `npm run check` fails when a linked line no longer holds the code it names.

What the cells mean:

- **Links** point to the implementation in that language. In the C/C++ column, the C entry points (`thesmos.h`, generated from [`core/cpp/src/lib.rs`](../core/cpp/src/lib.rs)) come first and the C++20 wrapper ([`thesmos.hpp`](../core/cpp/include/thesmos/thesmos.hpp)) follows.
- **via Rust:** C/C++ and Python bind the Rust receiver ([`core/rs`](../core/rs/src/lib.rs)). That behavior comes from it unchanged, through the linked dependency.
- **✗:** not available in that language.

## Checking proofs

| | TypeScript | Go | Rust | C/C++ | Python |
|---|---|---|---|---|---|
| Verifier from a root and an authentication adapter | [`createSpacesVerifier`](../core/ts/src/index.ts#L19) | [`NewVerifier`](../core/go/verifier.go#L56) | [`Verifier::new`](../core/rs/src/lib.rs#L94) | [`thesmos_verifier_new`](../core/cpp/src/lib.rs#L407) · [`Verifier`](../core/cpp/include/thesmos/thesmos.hpp#L224) | [`Verifier`](../core/py/src/lib.rs#L181) |
| Verify a proof | [`verify`](../core/ts/src/index.ts#L33) | [`Verify`](../core/go/verifier.go#L77) | [`verify`](../core/rs/src/lib.rs#L102) | [`thesmos_verify`](../core/cpp/src/lib.rs#L449) · [`Verifier::verify`](../core/cpp/include/thesmos/thesmos.hpp#L240) | [`verify`](../core/py/src/lib.rs#L234) |
| Decision: permitted, code, detail, checked steps | [`Decision`](../core/ts/src/types.ts#L30) | [`Decision`](../core/go/verifier.go#L30) | [`Decision`](../core/rs/src/lib.rs#L59) | [`thesmos_decision`](../core/cpp/include/thesmos/thesmos.h#L62) · [`Decision`](../core/cpp/include/thesmos/thesmos.hpp#L200) | [`Decision`](../core/py/src/lib.rs#L137) |
| Frozen law built in | [`law.generated`](../core/ts/src/data.ts#L8) | [`go:embed`](../core/go/law.go#L16) | [`include_bytes!`](../core/rs/src/law.rs#L8) | via Rust: [`bitspark-thesmos`](../core/cpp/Cargo.toml#L20) | via Rust: [`bitspark-thesmos`](../core/py/Cargo.toml#L20) |
| Law and layer digests | [`lawDigest`](../core/ts/src/data.ts#L19) · [`layerDigest`](../core/ts/src/data.ts#L23) | [`LawDigest`](../core/go/law.go#L82) · [`LayerDigest`](../core/go/law.go#L85) | [`law_digest`](../core/rs/src/law.rs#L95) · [`layer_digest`](../core/rs/src/law.rs#L100) | [`thesmos_law_digest`](../core/cpp/src/lib.rs#L386) · [`thesmos_layer_digest`](../core/cpp/src/lib.rs#L392) · [`law_digest`](../core/cpp/include/thesmos/thesmos.hpp#L187) · [`layer_digest`](../core/cpp/include/thesmos/thesmos.hpp#L188) | [`law_digest`](../core/py/src/lib.rs#L325) · [`layer_digest`](../core/py/src/lib.rs#L331) |
| Protocol limits: proof bytes, steps, depth | [`checkLimits`](../core/ts/src/proof.ts#L10) · [`maxProofBytes`](../core/ts/src/proof.ts#L25) | [`checkLimits`](../core/go/proof.go#L44) · [`MaxProofBytes`](../core/go/proof.go#L73) | [`check_limits`](../core/rs/src/proof.rs#L44) · [`max_proof_bytes`](../core/rs/src/proof.rs#L84) | via Rust | via Rust |
| Value helpers: symbol, fact, list, path, authorization | [`atom`](../core/ts/src/encoding.ts#L8) · [`fact`](../core/ts/src/encoding.ts#L12) · [`list`](../core/ts/src/encoding.ts#L14) · [`path`](../core/ts/src/encoding.ts#L19) · [`authorization`](../core/ts/src/encoding.ts#L29) | [`Symbol`](../core/go/values.go#L12) · [`Fact`](../core/go/values.go#L23) · [`List`](../core/go/values.go#L28) · [`Path`](../core/go/values.go#L38) · [`Authorization`](../core/go/values.go#L47) | [`symbol`](../core/rs/src/values.rs#L5) · [`fact`](../core/rs/src/values.rs#L10) · [`list`](../core/rs/src/values.rs#L15) · [`path`](../core/rs/src/values.rs#L21) · [`authorization`](../core/rs/src/values.rs#L26) | [`thesmos_symbol`](../core/cpp/src/lib.rs#L322) · [`thesmos_fact`](../core/cpp/src/lib.rs#L333) · [`thesmos_list`](../core/cpp/src/lib.rs#L350) · [`thesmos_path`](../core/cpp/src/lib.rs#L356) · [`thesmos_authorization`](../core/cpp/src/lib.rs#L371); C++ [`symbol`](../core/cpp/include/thesmos/thesmos.hpp#L152) · [`fact`](../core/cpp/include/thesmos/thesmos.hpp#L156) · [`list`](../core/cpp/include/thesmos/thesmos.hpp#L165) · [`path`](../core/cpp/include/thesmos/thesmos.hpp#L171) · [`authorization`](../core/cpp/include/thesmos/thesmos.hpp#L183) | [`symbol`](../core/py/src/lib.rs#L282) · [`fact`](../core/py/src/lib.rs#L289) · [`list`](../core/py/src/lib.rs#L295) · [`path`](../core/py/src/lib.rs#L302) · [`authorization`](../core/py/src/lib.rs#L319) |
| Your own authentication adapter | [`AuthenticateSpaceFacts`](../core/ts/src/types.ts#L29) | [`Authenticate`](../core/go/verifier.go#L26) | [`Authenticate`](../core/rs/src/lib.rs#L54) | [`thesmos_authenticate`](../core/cpp/include/thesmos/thesmos.h#L53) · [`Authenticate`](../core/cpp/include/thesmos/thesmos.hpp#L210) | [`authenticate`](../core/py/src/lib.rs#L194) (a callable) |
| Archon adapter (Ed25519ph, domain `thesmos/space-facts/v1`) | [`authenticateArchon`](../core/ts/src/archon.ts#L10) | [`archon.Authenticate`](../core/go/archon/archon.go#L18) | [`archon::authenticate`](../core/rs/src/archon.rs#L15) (default feature [`archon`](../core/rs/Cargo.toml#L28)) | [`thesmos_verifier_new_archon`](../core/cpp/src/lib.rs#L425) · [`Verifier::archon`](../core/cpp/include/thesmos/thesmos.hpp#L218) | [`Verifier.archon`](../core/py/src/lib.rs#L228) · [`archon_authenticate`](../core/py/src/lib.rs#L272) |
| A failing adapter denies as `invalid-proof` | [`catch`](../core/ts/src/index.ts#L47) | [`recover`](../core/go/verifier.go#L80) | [`catch_unwind`](../core/rs/src/lib.rs#L103)¹ | [`resume_unwind`](../core/cpp/src/lib.rs#L113)¹ · [`THESMOS_ADAPTER_FAILED`](../core/cpp/include/thesmos/thesmos.hpp#L267) | [`resume_unwind`](../core/py/src/lib.rs#L217)¹ ² |
| Decode a space-facts payload | [`decodeSpaceFacts`](../core/ts/src/bundles.ts#L16) | [`DecodeSpaceFacts`](../core/go/proof.go#L123) | [`decode_space_facts`](../core/rs/src/proof.rs#L121) | ✗ | [`decode_space_facts`](../core/py/src/lib.rs#L337) |
| Logos checker underneath | [`@bitspark/logos-contract`](../package.json#L28) | [`github.com/Bitspark/logos-contract/contract/go`](../core/go/go.mod#L7) | [`logos-contract`](../core/rs/Cargo.toml#L19) | via Rust | via Rust |

¹ The failure unwinds into the Rust receiver's [`catch_unwind`](../core/rs/src/lib.rs#L103), so it is caught only under Rust's default `panic = "unwind"`. Under `panic = "abort"` it ends the process.
² Any `Exception` the adapter raises denies the proof. Any other `BaseException` (`KeyboardInterrupt`, `SystemExit`, `GeneratorExit`) propagates out of `verify`.

## Producing proofs

A receiver only checks. Searching for a proof, supplying signed facts and serving remote proof requests are available only in TypeScript. Producers in other languages are tracked in [#36](https://github.com/Bitspark/thesmos/issues/36) (a native Logos producer bridge), [#7](https://github.com/Bitspark/thesmos/issues/7) (a transport-neutral asserter contract) and [#11](https://github.com/Bitspark/thesmos/issues/11) (collecting evidence and producing a proof).

| | TypeScript | Go | Rust | C/C++ | Python |
|---|---|---|---|---|---|
| Proof search | [`prove`](../core/ts/src/client.ts#L56) | ✗ | ✗ | ✗ | ✗ |
| Answer a proof request locally | [`answerProofRequest`](../core/ts/src/client.ts#L160) · [`createLocalProofProvider`](../core/ts/src/client.ts#L238) | ✗ | ✗ | ✗ | ✗ |
| Encode a proof | [`encodeProof`](../core/ts/src/proof.ts#L16) | ✗ | ✗ | ✗ | ✗ |
| Encode space facts and attribute clauses | [`encodeSpaceFacts`](../core/ts/src/bundles.ts#L8) · [`attributedClause`](../core/ts/src/encoding.ts#L44) | ✗ | ✗ | ✗ | ✗ |
| Sign space facts with Archon | [`signSpaceFacts`](../core/ts/src/archon.ts#L15) | ✗ | ✗ | ✗ | ✗ |
| Remote proof-provider contract and HTTP adapter | [`ProofProvider`](../core/ts/src/wire.ts#L55) · [`createHttpProofProvider`](../core/ts/src/remote.ts#L101) | ✗ | ✗ | ✗ | ✗ |
| Issuer/subject identity profile | [`issuerSubjectPrincipal`](../core/ts/src/identity.ts#L7) | ✗ | ✗ | ✗ | ✗ |

## Evidence

Every receiver is tested against the same inputs. The differential test runs every receiver on the same seeded inputs, including pairs at and just past every protocol limit. Its [driver](../scripts/differential/run.mjs) fails on any difference in decision, result code or step count, and on any receiver panic.

| | TypeScript | Go | Rust | C/C++ | Python |
|---|---|---|---|---|---|
| Frozen corpus, [`law/conformance.ontos`](../law/conformance.ontos) (53 cases) | [`cases`](../core/ts/test/sdk.test.ts#L22) | [`TestFrozenConformanceCorpus`](../core/go/thesmos_test.go#L101) | [`frozen_conformance_corpus`](../core/rs/src/tests.rs#L102) | [`frozen_conformance_corpus`](../core/cpp/tests/receiver.cpp#L101) | [`test_frozen_conformance_corpus`](../core/py/tests/test_receiver.py#L71) |
| Archon-signed proof written by [TypeScript](../scripts/export-archon-vector.mjs) | [`Archon vector`](../core/ts/test/sdk.test.ts#L36) | [`TestTypeScriptArchonProofVerifies`](../core/go/archon/archon_test.go#L16) | [`typescript_archon_proof_verifies`](../core/rs/tests/archon.rs#L14) | [`typescript_archon_proof_verifies`](../core/cpp/tests/receiver.cpp#L116) | [`test_typescript_archon_proof_verifies`](../core/py/tests/test_receiver.py#L160) |
| Differential decider | [`verify`](../scripts/differential/decide-ts.mjs#L28) (the reference) | [`main`](../core/go/internal/differential/main.go#L37) | [`main`](../core/rs/examples/differential.rs#L20) | [`main`](../core/cpp/tests/differential.cpp#L65) | [`main`](../core/py/tests/differential.py#L30) |
| Built and run as a consumer gets it | [`pack`](../scripts/check-package.mjs#L12) | [`go get`](../scripts/consumers/run.sh#L53) | [`cargo run`](../scripts/consumers/run.sh#L80) | [`cmake`](../scripts/consumers/run.sh#L90) | [`pip install`](../scripts/consumers/run.sh#L86) |
| CI job | [`sdk`](../.github/workflows/check.yml#L47) | [`go`](../.github/workflows/check.yml#L86) | [`rust`](../.github/workflows/check.yml#L106) | [`cpp`](../.github/workflows/check.yml#L151) · [`cpp-header`](../.github/workflows/check.yml#L131) | [`python`](../.github/workflows/check.yml#L178) |
| CI platforms | Linux | Linux | Windows, Linux, macOS | Linux, macOS | Windows, Linux, macOS, each on Python 3.10 and 3.13 |
| When those tests run in CI | every run, except on a fork's pull request | every run | every run | every run, with `cpp-header` (the generated header equals the committed one) | every run |

Go, Rust, C/C++ and Python build from public sources only: Logos's contract comes from crates.io and as a public Go module. The TypeScript SDK's development dependencies include Logos's kernel, a private GitHub package, so the `sdk` and `differential` jobs skip a fork's pull request. `consumer` skips it too, because the consumers clone thesmos at a commit on this repository's branches. A release cites one run in which every receiver job ran ([CONTRIBUTING.md](../CONTRIBUTING.md)).

## Distribution

| | TypeScript | Go | Rust | C/C++ | Python |
|---|---|---|---|---|---|
| Package | [`@bitspark/thesmos`](../package.json#L2) | [`github.com/Bitspark/thesmos/core/go`](../core/go/go.mod#L1) | crate [`bitspark-thesmos`](../core/rs/Cargo.toml#L2), library `thesmos` | CMake project [`thesmos`](../core/cpp/CMakeLists.txt#L10) | [`bitspark-thesmos`](../core/py/pyproject.toml#L6), module `thesmos` |
| How to depend on it | [`npm install @bitspark/thesmos`](../README.md#status) | [module tag `core/go/v<version>`](../README.md#go-receiver) | [crates.io, or git at tag `v<version>`](../README.md#rust-receiver) | [`add_subdirectory` or FetchContent](../README.md#c-and-c-receiver) | [`pip install --pre bitspark-thesmos`](../README.md#python-receiver) |
| Toolchain | [Node 24](../package.json#L7) | [Go 1.25](../core/go/go.mod#L3) | [Rust 1.96](../core/rs/rust-toolchain.toml#L5) | [C++20](../core/cpp/CMakeLists.txt#L33) and [Rust 1.96](../core/cpp/rust-toolchain.toml#L4) | [Python 3.10+](../core/py/pyproject.toml#L9) and [Rust 1.96](../core/py/rust-toolchain.toml#L4) |
| Private dependencies | only the optional `@bitspark/logos-kernel` for `/client`, through GitHub Packages | none | none | none | none |

From preview.8, each release is published to npm, crates.io and PyPI by its release workflow (preview.7 is on npm and crates.io), and attaches the npm archive with `SHA256SUMS` to its GitHub release; the Go module's tag resolves through proxy.golang.org. See [CONTRIBUTING.md](../CONTRIBUTING.md) for how a release is made.
