# Contributing

thesmos defines authority; Logos derives and checks; Ontos carries values;
Archon authenticates signatures. Keep these responsibilities separate.

The source of the common law is law/common-law.logos and the core assertion
template. Its checked-in Ontos form is compiled by Logos. A fact is an
attributed rule with an empty body. The asserter template is a separate layer.
No code may implement authority semantics of its own: the law and layer are the
sole specification. An evaluator for an admitted profile may decide locally
under the shared conformance contract and is trusted for those decisions;
portable proofs must pass the unchanged checker; consumer adapters implement no
authorization semantics. No local evaluator is admitted until its profile and
conformance corpus are published and the gate in issue 19 passes. See [the
runtime decision](docs/runtime.md).

Use a task worktree, branch and pull request. Run `npm run check`, obtain an
independent review of the exact change, and squash merge after the required
checks pass. The gate checks compiled law identity, frozen artifacts, conformance,
TypeScript tests, the service examples and an independently installed tarball,
including each entry point's import isolation, for code and declarations: the
root, `/identity` and `/remote` import no search engine, signing library,
network module, filesystem or module loader, or other entry, and `/remote`
reaches its provider only through the caller's `fetch`; `/archon` imports no search engine
or network module; and `/client` imports no network module. A consumer with no
Logos kernel or Archon installed must type-check and use `/remote`.

The root, `/identity` and `/remote` read no files at runtime (`/client`'s Logos
kernel still loads its WASM binary). `npm run build` first runs
`scripts/embed-law.mjs`, which generates `core/ts/src/law.generated.ts` from
`law/*.ontos` and `law/protocol.json`; that file is never edited or committed.
The `law/` files stay the only source, compiled from `.logos` by
`scripts/compile-law.ts` and pinned by `conformance/frozen.json`.

The Go receiver in `core/go` is fetched as source with no build step, so it embeds
a committed byte copy of `law/` and the corpus (`node scripts/embed-law.mjs --go`).
`npm run law:check` fails if that copy differs. Keep Go and TypeScript decisions
identical: a receiver change lands in both, and both pass `law/conformance.ontos`
and the shared Archon vector (`scripts/export-archon-vector.mjs`). Run
`go test ./...` in `core/go`; the `go` CI job does the same.

The Rust receiver in `core/rs` carries its own byte copy for the same reason: a git
or vendored crate holds only its directory (`node scripts/embed-law.mjs --rs`, checked
by `npm run law:check`). It follows the same rule: a receiver change lands in
TypeScript, Go and Rust, and all three pass the corpus and the Archon vector. Run
`cargo test` in `core/rs`; the `rust` CI job does the same on Windows, Linux and macOS.

The C and C++ receiver in `core/cpp` is the Rust receiver behind a C ABI: it has no
receiver logic or law copy of its own, so a receiver change reaches it through
`core/rs`. After changing `core/cpp/src/lib.rs`, regenerate the committed header with
`cbindgen --config cbindgen.toml --output include/thesmos/thesmos.h src/lib.rs` in
`core/cpp` (cbindgen 0.29.4); the `cpp-header` CI job fails on any difference. Build and test
with `cmake -S core/cpp -B build && cmake --build build && ctest --test-dir build`,
which needs OpenSSL 3 for the corpus's example keys. The `cpp` CI job does the same on
Linux and macOS.

The Python receiver in `core/py` is the Rust receiver behind PyO3, likewise with no
receiver logic or law copy of its own. Keep `core/py/thesmos.pyi` in step with
`core/py/src/lib.rs`. Build and test it in a virtual environment with
`pip install maturin pytest cryptography`, then `maturin develop --locked` and
`pytest tests` in `core/py`. On a `windows-gnu` Rust toolchain, PyO3 also needs MinGW's
`dlltool` on `PATH`. The `python` CI job does the same on Windows, Linux and macOS with
CPython 3.10 and 3.13; it uploads no wheel.

The receivers must decide alike. `node scripts/differential/run.mjs` (after
`npm run build`, with Go, Rust, the installed Python extension and the C++ decider
`thesmos_differential` built in `core/cpp/build`) feeds every receiver the frozen corpus,
the Archon vector and seeded mutations of both, and fails unless TypeScript, Go, Rust,
Python and C++ agree on permitted, code and checked steps for each input; `--seed <n>`
reproduces a CI run and `--langs ts,go,rs` narrows it. C++ decides through its C
interface, so the comparison covers that layer too. The `differential` CI job runs it
with a fixed seed and with the run's own seed.

[docs/languages.md](docs/languages.md) shows what each language offers and links each
entry to the line that implements it. A change that adds, removes or moves a public
entry point in any language updates it. `scripts/check-links.mjs` fails when a linked
line no longer holds the code its link names.

Each receiver must also work as an outside project gets it.
`bash scripts/consumers/run.sh prepare <commit> <dir>` makes a fresh Go module, a Rust
crate with a git dependency, a pip virtual environment and a CMake project with
FetchContent, each taking thesmos at that commit as README.md shows with a tag. `verify`
builds them with Cargo and Go offline and checks that each accepts the TypeScript-signed
Archon proof and denies it with one changed byte. The `consumer` CI job runs both on the
commit under test. A release is qualified before it is tagged; after tagging,
`run.sh tag <release commit> <version>` checks that `v<version>` and the Go module's
`core/go/v<version>` (through proxy.golang.org)
resolve to the release commit on main. With squash merges that is not the qualified PR
head, only a commit with the same `core/` tree.

A release cites one qualifying run in which the `go`, `rust`, `cpp`, `python`,
`differential` and `consumer` jobs' tests ran on the release commit, or on a commit whose
`core/` tree is identical (`git diff <that> <release> -- core` is empty). The `release`
workflow makes the release and checks this rule itself:

1. A release PR sets the new version in every field (`node scripts/embed-law.mjs
   --check-rs` names any it missed: the manifests, their lock entries and CMake's
   numeric version) and adds `docs/releases/v<version>.md`. Its first line,
   `# v<version>: <title>`, names the release; the rest is its notes.
2. The PR's `check` run on its head is the qualifying run.
3. The PR is squash-merged. The merge commit on main is the release commit, and its
   `check` run builds the npm archive.
4. Dispatch `release` from main with the version, the release commit and the
   qualifying run and attempt, in mode `rehearse`, then `release`. Both modes check
   through the API that the qualifying run succeeded on a commit with the release
   commit's `core/` tree, and that each of its receiver jobs ran every step. They also
   check that every version
   field at the release commit agrees and that the tags are absent or already at the
   release commit. `release` then waits for approval in the `release` environment. It
   creates `v<version>` and `core/go/v<version>` at the release commit and the GitHub
   release with the archive, `release-manifest.json` and `SHA256SUMS`, or finishes a
   partial release; it never moves a tag or replaces a file. It ends with `verify`,
   which can also be dispatched alone: the tags resolve to the release commit
   (`run.sh tag`) and the files match `SHA256SUMS`.

`bash scripts/release/release.sh check|candidate|publish --dry-run|verify` runs the same
steps locally with an authenticated `gh`. It publishes to no package registry yet (#49,
#12).
Treat test fixtures as evidence, not permission to change the model.

Node 24 is required. The SDK's development dependencies include Logos's kernel, which
is published only as a private GitHub package, so the lockfile installs the `@bitspark`
scope from GitHub Packages with read access; see README.md. Never commit a credential or an npm configuration
containing one. Public package publication waits for an anonymous dependency
installation test. No public npm release is implied by a source preview.

For a dependency update, the `check` workflow's `refresh_lock` dispatch prepares
the lockfile on its runner and retains it as `thesmos-lock-<source revision>`.
Commit that artifact with the manifest, then run the ordinary complete gate on
the resulting revision. Lock preparation alone never qualifies a release.

Contributions are licensed under Apache-2.0.
