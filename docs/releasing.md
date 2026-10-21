# Source preview releases

The established distribution is a GitHub prerelease containing the exact archive
from the complete `check` workflow. It requires access to the private logos
dependencies. Public npm publication remains conditional on anonymous dependency
installation; an authenticated archive check does not establish that condition.

When advancing logos, first wait for its family release and the required runtime
qualification. Dispatch `check.yml` on the task branch with operation
`refresh-dependencies`, the exact published `logos_version` and the intended
`package_version`. This job resolves only published packages and produces an
input-revision-bound patch and receipt. It neither commits nor publishes. Verify
the receipt and patch digest, apply the patch in the task worktree, update the
release explanation, and commit. Dependency preparation runs on the GitHub runner.

Require the ordinary complete `check` workflow on that committed revision, without
candidate archive overrides, and an independent review before squash merging.
After merging, require the complete check on the exact target commit. Its
`thesmos-package` artifact contains the tested tarball, `SHA256SUMS` and
`release-artifact.json`. Verify the archive digest, manifest version, source commit
and successful workflow before publishing that same archive in an immutable
`v<package-version>` GitHub prerelease. Do not rebuild it during publication.

Release notes record the checks, dependency access requirement, frozen-law
identity and any measured limits. A runtime release is distinct from the
production adoption decision in issue 19. Consumers advance their released
dependency locks and validate the installed package without workspace source links
before claiming released integration.
