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
`go test ./...` in `core/go` with `GOPRIVATE=github.com/Bitspark/logos`. In CI the
`go` job tests only when the service desk has issued its read-only
`LOGOS_SOURCE_READ_TOKEN`, and otherwise warns that Go was not tested. A release
needs a qualifying run in which that job's tests ran.

The Rust receiver in `core/rs` carries its own byte copy for the same reason: a git
or vendored crate holds only its directory (`node scripts/embed-law.mjs --rs`, checked
by `npm run law:check`). It follows the same rule: a receiver change lands in
TypeScript, Go and Rust, and all three pass the corpus and the Archon vector. Run
`cargo test` in `core/rs` with `CARGO_NET_GIT_FETCH_WITH_CLI=true` and git read
access to Bitspark/logos. The `rust` CI job (Windows, Linux, macOS) uses the same
token and the same warning.

The C and C++ receiver in `core/cpp` is the Rust receiver behind a C ABI: it has no
receiver logic or law copy of its own, so a receiver change reaches it through
`core/rs`. After changing `core/cpp/src/lib.rs`, regenerate the committed header with
`cbindgen --config cbindgen.toml --output include/thesmos/thesmos.h src/lib.rs` in
`core/cpp` (cbindgen 0.29.4); the `cpp-header` CI job fails on any difference. Build and test
with `cmake -S core/cpp -B build && cmake --build build && ctest --test-dir build`,
which needs the same Logos access and OpenSSL 3 for the corpus's example keys. The
`cpp` job (Linux, macOS) uses the same token and the same warning.

The Python receiver in `core/py` is the Rust receiver behind PyO3, likewise with no
receiver logic or law copy of its own. Keep `core/py/thesmos.pyi` in step with
`core/py/src/lib.rs`. Build and test it in a virtual environment with
`pip install maturin pytest cryptography`, then `maturin develop --locked` and
`pytest tests` in `core/py`, which needs the same Logos access. On a `windows-gnu` Rust
toolchain, PyO3 also needs MinGW's `dlltool` on `PATH`. The `python` job (Windows,
Linux, macOS; CPython 3.10 and 3.13) uses the same token and the same warning, and
never uploads a wheel, which would hold compiled Logos code.

The receivers must decide alike. `node scripts/differential/run.mjs` (after
`npm run build`, with Go, Rust and the installed Python extension) feeds every
receiver the frozen corpus, the Archon vector and seeded mutations of both, and fails
unless TypeScript, Go, Rust and Python agree on permitted, code and checked steps for
each input; `--seed <n>` reproduces a CI run and `--langs ts,go,rs` narrows it. C/C++
binds `core/rs` and is covered through it. The `differential` CI job runs it with a fixed
seed and with the run's own seed.

A release cites one qualifying run in which the `go`, `rust`, `cpp`, `python` and
`differential` jobs' tests ran on the release commit, or on a commit whose `core/` tree
is identical (`git diff <that> <release> -- core` is empty).
Treat test fixtures as evidence, not permission to change the model.

Node 24 is required. The current Logos packages require GitHub Packages read
access; see README.md. Never commit a credential or an npm configuration
containing one. Public package publication waits for an anonymous dependency
installation test. No public npm release is implied by a source preview.

For a dependency update, the `check` workflow's `refresh_lock` dispatch prepares
the lockfile on its runner and retains it as `thesmos-lock-<source revision>`.
Commit that artifact with the manifest, then run the ordinary complete gate on
the resulting revision. Lock preparation alone never qualifies a release.

Contributions are licensed under Apache-2.0.
