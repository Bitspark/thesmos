#!/usr/bin/env bash
# The release steps. .github/workflows/release.yml runs them; each also runs locally with an
# authenticated gh. A release is qualified on its release PR's head by a check.yml run in which
# every receiver job ran, squash-merged into main, and released from that merge commit, the release
# commit (CONTRIBUTING.md).
#
#   bash scripts/release/release.sh check     <version> <commit> <run> <attempt>
#   bash scripts/release/release.sh candidate <version> <commit> <run> <attempt> <dir>
#   bash scripts/release/release.sh publish   <version> <commit> <dir> [--dry-run]
#   bash scripts/release/release.sh verify    <version> <commit>
#
# check      The release commit is on main, carries <version> in every field (its own
#            `embed-law.mjs --check-rs`) and has notes in docs/releases/v<version>.md. The
#            qualifying run, attempt <attempt> of check.yml run <run>, succeeded on a commit with
#            the same core/ tree, and each of its receiver jobs succeeded without skipping a step
#            (a fork's pull request skips the differential and consumer jobs). v<version> and
#            core/go/v<version> are absent or already at the release commit.
# candidate  After check, writes to <dir> the npm archive that check.yml's sdk job built and tested from the
#            release commit (its push run on main), release-manifest.json and SHA256SUMS. Given
#            the same inputs it writes the same bytes.
# publish    Creates the missing tags at the release commit and the GitHub release with the
#            candidate's files, or finishes a partial release. It never moves a tag or replaces a
#            file: anything present that differs stops it.
# verify     Reads only: the tags resolve to the release commit (git and proxy.golang.org), and
#            the release's files match its SHA256SUMS and carry <version>.
set -euo pipefail

fail() { echo "release: $*" >&2; exit 1; }
phase=${1:?phase}
version=${2:?version}
commit=${3:?release commit}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || fail "not a version: $version"
[[ $commit =~ ^[0-9a-f]{40}$ ]] || fail "the release commit must be a full hash: $commit"
repo=${GITHUB_REPOSITORY:-Bitspark/thesmos}
remote=https://github.com/$repo
tools=$(cd "$(dirname "$0")/../.." && pwd)
tag=v$version
go_tag=core/go/v$version
package=bitspark-thesmos-$version.tgz
scratch=$(mktemp -d)
trap 'git -C "$tools" worktree remove --force "$scratch/tree" >/dev/null 2>&1 || true; rm -rf "$scratch"' EXIT

# The receiver jobs, as check.yml names them. A release needs all of them.
receiver_jobs=(go "rust (windows-latest)" "rust (ubuntu-latest)" "rust (macos-latest)"
  "cpp (ubuntu-latest)" "cpp (macos-latest)"
  "python (windows-latest, 3.10)" "python (windows-latest, 3.13)" "python (ubuntu-latest, 3.10)"
  "python (ubuntu-latest, 3.13)" "python (macos-latest, 3.10)" "python (macos-latest, 3.13)"
  differential consumer)

# The commit a tag names, or nothing; an annotated tag's ^{} line names its commit.
tag_at() { git ls-remote "$remote" "refs/tags/$1" "refs/tags/$1^{}" | sort -k2 | tail -1 | cut -f1; }

release_tree() {
  local main
  main=$(git ls-remote "$remote" refs/heads/main | cut -f1)
  git -C "$tools" fetch -q "$remote" "$main" "$commit"
  git -C "$tools" merge-base --is-ancestor "$commit" "$main" || fail "$commit is not on main"
  git -C "$tools" worktree add -q --detach "$scratch/tree" "$commit"
}

notes_title() {
  local first
  first=$(head -1 "$1")
  first=${first%$'\r'}
  [[ $first == "# $tag: "?* ]] || fail "docs/releases/$tag.md must start with '# $tag: <title>'"
  echo "${first#\# }"
}

qualify() {
  local run=$1 attempt=$2 path status conclusion head jobs job line
  [[ $run =~ ^[0-9]+$ && $attempt =~ ^[0-9]+$ ]] || fail "rehearse and release need the qualifying check.yml run and attempt (numbers): got run='$run' attempt='$attempt'"
  IFS=$'\t' read -r path status conclusion head < <(gh api "repos/$repo/actions/runs/$run/attempts/$attempt" \
    --jq '[.path, .status, .conclusion, .head_sha] | @tsv')
  [ "$path" = .github/workflows/check.yml ] || fail "run $run is $path, not check.yml"
  [ "$status $conclusion" = "completed success" ] || fail "run $run attempt $attempt is $status $conclusion"
  git -C "$tools" fetch -q "$remote" "$head"
  git -C "$tools" diff --quiet "$head" "$commit" -- core ||
    fail "core/ differs between the qualifying head $head and $commit"
  jobs=$(gh api "repos/$repo/actions/runs/$run/attempts/$attempt/jobs?per_page=100" \
    --jq '.jobs[] | [.name, .conclusion, ([.steps[] | select(.conclusion != "success")] | length)] | @tsv')
  for job in "${receiver_jobs[@]}"; do
    line=$(awk -F'\t' -v name="$job" '$1 == name' <<<"$jobs")
    [ -n "$line" ] || fail "run $run attempt $attempt has no job '$job'"
    [ "$(cut -f2,3 <<<"$line")" = $'success\t0' ] ||
      fail "'$job' in run $run attempt $attempt did not run every step successfully"
  done
  echo "qualified: run $run attempt $attempt on $head (core/ equals $commit's), ${#receiver_jobs[@]} receiver jobs ran every step"
}

check() {
  local at
  release_tree
  (cd "$scratch/tree" && node scripts/embed-law.mjs --check-rs >/dev/null) || fail "the version fields at $commit disagree"
  [ "$(cd "$scratch/tree" && node -p 'require("./package.json").version')" = "$version" ] ||
    fail "package.json at $commit is not $version"
  qualify "$@"
  for t in "$tag" "$go_tag"; do
    at=$(tag_at "$t")
    [ -z "$at" ] || [ "$at" = "$commit" ] || fail "$t already exists at $at, not $commit"
  done
  [ -s "$scratch/tree/docs/releases/$tag.md" ] || fail "$commit has no docs/releases/$tag.md"
  notes_title "$scratch/tree/docs/releases/$tag.md" >/dev/null
  echo "checked: $tag at $commit"
}

candidate() {
  local run=$1 attempt=$2 dir=$3 sdk_run head packed sha
  mkdir -p "$dir"
  [ -z "$(ls -A "$dir")" ] || fail "$dir is not empty"
  sdk_run=$(gh api "repos/$repo/actions/workflows/check.yml/runs?head_sha=$commit&event=push&status=success&per_page=1" \
    --jq '.workflow_runs[0].id // empty')
  [ -n "$sdk_run" ] || fail "no successful check.yml push run on $commit"
  gh run download "$sdk_run" -R "$repo" -n thesmos-package -D "$dir" ||
    fail "cannot download thesmos-package from run $sdk_run (artifacts expire after 90 days)"
  [ "$(ls "$dir")" = "$package" ] || fail "run $sdk_run's thesmos-package is not exactly $package: $(ls "$dir")"
  packed=$(tar -xzO -f - package/package.json < "$dir/$package" | node -p 'JSON.parse(require("fs").readFileSync(0)).version')
  [ "$packed" = "$version" ] || fail "$package carries version $packed"
  sha=$(sha256sum "$dir/$package" | cut -d' ' -f1)
  head=$(gh api "repos/$repo/actions/runs/$run/attempts/$attempt" --jq .head_sha)
  cat > "$dir/release-manifest.json" <<EOF
{
  "version": "$version",
  "commit": "$commit",
  "tags": ["$tag", "$go_tag"],
  "qualifying_run": { "id": $run, "attempt": $attempt, "head": "$head" },
  "npm_package": { "file": "$package", "sha256": "$sha", "built_by_run": $sdk_run, "artifact": "thesmos-package" }
}
EOF
  (cd "$dir" && sha256sum "$package" release-manifest.json > SHA256SUMS)
  echo "candidate: $package ($sha) from run $sdk_run"
}

publish() {
  local dir=$1 dry=${2:-} at title prerelease=() existing name release=absent
  local missing_tags=() missing_files=()
  # Everything is checked before anything is written, so a refusal leaves the release untouched.
  (cd "$dir" && sha256sum --quiet -c SHA256SUMS) || fail "$dir does not match its SHA256SUMS"
  for t in "$tag" "$go_tag"; do
    at=$(tag_at "$t")
    if [ -z "$at" ]; then missing_tags+=("$t")
    elif [ "$at" = "$commit" ]; then echo "tag $t: already at $commit"
    else fail "$t already exists at $at, not $commit"
    fi
  done
  if existing=$(gh release view "$tag" -R "$repo" --json assets --jq '.assets[].name' 2>/dev/null); then
    release=present
    for name in $existing; do
      [[ $name == "$package" || $name == release-manifest.json || $name == SHA256SUMS ]] ||
        fail "release $tag has a file this release does not make: $name"
    done
    for name in "$package" release-manifest.json SHA256SUMS; do
      if grep -qxF "$name" <<<"$existing"; then
        mkdir -p "$scratch/attached"
        gh release download "$tag" -R "$repo" -p "$name" -D "$scratch/attached" --clobber
        cmp -s "$scratch/attached/$name" "$dir/$name" || fail "release $tag already has a different $name"
        echo "release $tag: $name already attached, identical"
      else
        missing_files+=("$name")
      fi
    done
  else
    git -C "$tools" fetch -q "$remote" "$commit"
    git -C "$tools" show "$commit:docs/releases/$tag.md" > "$scratch/notes.md" || fail "$commit has no docs/releases/$tag.md"
    title=$(notes_title "$scratch/notes.md")
    # The notes after the title line, without the blank lines that separate them from it.
    awk 'NR > 1 && (body || NF) { body = 1; print }' "$scratch/notes.md" > "$scratch/body.md"
    [[ $version == *-* ]] && prerelease=(--prerelease)
  fi
  if [ "$dry" = --dry-run ]; then
    echo "would create tags: ${missing_tags[*]:-none}"
    [ "$release" = present ] && echo "would attach: ${missing_files[*]:-nothing}" ||
      echo "would create release $tag ('$title') with $package, release-manifest.json and SHA256SUMS"
    return
  fi
  for t in ${missing_tags[@]+"${missing_tags[@]}"}; do
    gh api -X POST "repos/$repo/git/refs" -f ref="refs/tags/$t" -f sha="$commit" --silent
    echo "tag $t: created at $commit"
  done
  if [ "$release" = absent ]; then
    gh release create "$tag" -R "$repo" --verify-tag --title "$title" --notes-file "$scratch/body.md" \
      ${prerelease[@]+"${prerelease[@]}"} "$dir/$package" "$dir/release-manifest.json" "$dir/SHA256SUMS"
    echo "release $tag: created with $package, release-manifest.json and SHA256SUMS"
  fi
  for name in ${missing_files[@]+"${missing_files[@]}"}; do
    gh release upload "$tag" -R "$repo" "$dir/$name"
    echo "release $tag: attached $name"
  done
}

verify() {
  local state names file
  bash "$tools/scripts/consumers/run.sh" tag "$commit" "$version"
  state=$(gh release view "$tag" -R "$repo" --json isDraft,isPrerelease --jq '"\(.isDraft) \(.isPrerelease)"') ||
    fail "there is no release $tag"
  [ "$state" = "false $([[ $version == *-* ]] && echo true || echo false)" ] ||
    fail "release $tag is draft/prerelease $state"
  gh release download "$tag" -R "$repo" -D "$scratch/release"
  [ -f "$scratch/release/SHA256SUMS" ] || fail "release $tag has no SHA256SUMS"
  (cd "$scratch/release" && sha256sum --quiet -c SHA256SUMS) || fail "release $tag's files do not match its SHA256SUMS"
  names=$(sed 's/^[0-9a-f]* [ *]//' "$scratch/release/SHA256SUMS")
  grep -qxF "$package" <<<"$names" || fail "SHA256SUMS does not cover $package"
  for file in "$scratch/release"/*; do
    [ "$(basename "$file")" = SHA256SUMS ] || grep -qxF "$(basename "$file")" <<<"$names" ||
      fail "SHA256SUMS does not cover $(basename "$file")"
  done
  [ "$(tar -xzO -f - package/package.json < "$scratch/release/$package" | node -p 'JSON.parse(require("fs").readFileSync(0)).version')" = "$version" ] ||
    fail "$package does not carry $version"
  if [ -f "$scratch/release/release-manifest.json" ]; then
    node -e '
      const [file, version, commit] = process.argv.slice(1);
      const m = JSON.parse(require("fs").readFileSync(file, "utf8"));
      if (m.version !== version || m.commit !== commit) { console.error(`release-manifest.json names ${m.version} at ${m.commit}`); process.exit(1); }
    ' "$scratch/release/release-manifest.json" "$version" "$commit" || fail "release-manifest.json disagrees"
  fi
  echo "verified: $tag at $commit, $(wc -l < "$scratch/release/SHA256SUMS") files match SHA256SUMS"
}

shift 3
case $phase in
  check) check "${1:-}" "${2:-}" ;;
  candidate) candidate "${1:-}" "${2:-}" "${3:?directory}" ;;
  publish) publish "${1:?directory}" "${2:-}" ;;
  verify) verify ;;
  *) fail "unknown phase: $phase" ;;
esac
