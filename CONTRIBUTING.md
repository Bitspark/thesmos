# Contributing

thesmos defines authority; Logos derives and checks; Ontos carries values;
Archon authenticates signatures. Keep these responsibilities separate.

The source of the common law is law/common-law.logos and the core assertion
template. Its checked-in Ontos form is compiled by Logos. A fact is an
attributed rule with an empty body. The asserter template is a separate layer.
No TypeScript code may implement a second authority evaluator.

Use a task worktree, branch and pull request. Run `npm run check`, obtain an
independent review of the exact change, and squash merge after the required
checks pass. The gate checks compiled law identity, frozen artifacts, conformance,
TypeScript tests, the service examples and an independently installed tarball,
including each entry point's import isolation: the root and `/identity` import no
search engine, signing library, network module or other entry, and `/archon`
imports no search engine.
Treat test fixtures as evidence, not permission to change the model.

Node 24 is required. The current Logos packages require GitHub Packages read
access; see README.md. Never commit a credential or an npm configuration
containing one. Public package publication waits for an anonymous dependency
installation test. No public npm release is implied by a source preview.

Contributions are licensed under Apache-2.0.
