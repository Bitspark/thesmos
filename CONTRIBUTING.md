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
