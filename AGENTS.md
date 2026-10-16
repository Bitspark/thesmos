# Working on thesmos

Read README.md, docs/model.md and CONTRIBUTING.md. This repository implements
the frozen Spaces core, revision 3. Preserve its five authority rules and the
exact declarative artifacts in law/. Changes to those artifacts require an
explicitly authorized model revision, never an inferred security improvement.

Derive behavior through the existing law before proposing an addition. Keep
authentication adapters, proof search, transport, persistence and temporal
policy separate. Root authority includes descendant authority; delegation does
not remove the issuer's rights. There is no publication permission, universal
root lease, built-in expiry or mandatory original-author signature on an
authorized asserter's output.

Work in a separate task branch and worktree. Use a PR, independent review and
the maintained npm run check gate before merging. The main checkout stays on
main. Do not copy private legacy history, operations files or research into
this public repository. Do not import the old checker or add compatibility
decoders. Code in test/recipes.ts is synthetic conformance fixture construction,
not the client API or an alternative reasoner.
