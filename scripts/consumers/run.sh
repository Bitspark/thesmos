#!/usr/bin/env bash
# The consumer check: each language's receiver, built from one thesmos commit the way an outside
# project gets it (README.md), verifies the TypeScript-signed Archon proof and denies it with one
# changed byte.
#
#   bash scripts/consumers/run.sh prepare <commit> <dir>
#   bash scripts/consumers/run.sh verify <commit> <dir>
#   bash scripts/consumers/run.sh tag <commit> <version>
#
# prepare is the only phase that needs read access to the private Logos sources. It fetches thesmos
# at <commit> into <dir>/thesmos, makes a fresh Go module and Rust crate that require it at that
# commit, and fetches what their builds need. pip and CMake clone thesmos themselves in verify,
# and their Cargo builds resolve core/py's and core/cpp's own Cargo.lock, so prepare fetches those
# locked sources into CARGO_HOME from the same commit. Go needs GOPRIVATE to name
# github.com/Bitspark/logos and github.com/Bitspark/thesmos (the module proxy need not serve an
# unmerged commit).
#
# verify runs without Logos access, with Cargo and Go offline: go run, cargo run, pip install
# "git+…@<commit>#subdirectory=core/py" into a fresh virtual environment, and a CMake project
# with FetchContent at <commit>. pip still fetches its build backend, and CMake its sources.
#
# A release is qualified before it is tagged, usually on its PR head. After tagging, tag checks
# without Logos access that the tags consumers name resolve to <commit>, the release commit on
# main that the tags point to (with squash merges not the qualified PR head, whose core/ tree it
# carries): the root tag v<version> (Cargo, pip, FetchContent) through git, and the Go module's
# core/go/v<version> through proxy.golang.org, as a Go consumer resolves it.
set -euo pipefail

phase=${1:?phase}
rev=${2:?commit}
arg=${3:?directory or version}
here=$(cd "$(dirname "$0")" && pwd)
repo=https://github.com/Bitspark/thesmos
[[ $rev =~ ^[0-9a-f]{40}$ ]] || { echo "the commit must be a full hash: $rev" >&2; exit 2; }
dir=$arg
src=$dir/thesmos
toolchain() { sed -n 's/^channel *= *"\(.*\)"/\1/p' "$src/core/rs/rust-toolchain.toml"; }

prepare() {
  # Replaces only a directory that an earlier prepare made.
  if [ -e "$dir" ]; then
    [ -f "$dir/.thesmos-consumers" ] || { echo "refusing to replace $dir" >&2; exit 2; }
    rm -rf "$dir"
  fi
  mkdir -p "$dir"
  touch "$dir/.thesmos-consumers"
  git init --quiet "$src"
  git -C "$src" fetch --quiet --depth 1 "$repo" "$rev"
  git -C "$src" -c advice.detachedHead=false checkout --quiet FETCH_HEAD

  echo "== Go: github.com/Bitspark/thesmos/core/go@$rev"
  mkdir "$dir/go"
  cp "$here/go/main.go" "$dir/go/"
  (cd "$dir/go" && go mod init example.com/thesmos-consumer && go get "github.com/Bitspark/thesmos/core/go@$rev" && go mod tidy)

  echo "== Rust: bitspark-thesmos at rev $rev"
  mkdir -p "$dir/rs/src"
  sed "s/@REV@/$rev/" "$here/rs/Cargo.toml.in" > "$dir/rs/Cargo.toml"
  cp "$here/rs/main.rs" "$dir/rs/src/main.rs"
  cp "$src/core/rs/rust-toolchain.toml" "$dir/rs/"
  (cd "$dir/rs" && cargo fetch)

  echo "== Python and C/C++: their locked sources"
  (cd "$src/core/py" && cargo fetch --locked)
  (cd "$src/core/cpp" && cargo fetch --locked)
  mkdir "$dir/py" "$dir/cpp"
  cp "$here/py/verify.py" "$dir/py/"
  cp "$here/cpp/CMakeLists.txt" "$here/cpp/main.cpp" "$dir/cpp/"
}

verify() {
  # GOPROXY=off alone would still fetch GOPRIVATE modules from git.
  export CARGO_NET_OFFLINE=true GOPROXY=off GONOPROXY=none
  local vector=$src/core/rs/tests/data/archon-document.ontos
  [ -f "$vector" ] || { echo "run prepare first" >&2; exit 2; }

  echo "== Go"
  (cd "$dir/go" && go run . "$vector")

  echo "== Rust"
  (cd "$dir/rs" && cargo run --quiet --release --locked -- "$vector")

  echo "== Python"
  "${PYTHON:-python3}" -m venv "$dir/py/venv"
  local python=$dir/py/venv/bin/python
  [ -x "$python" ] || python=$dir/py/venv/Scripts/python.exe
  "$python" -m pip install --quiet --no-cache-dir "git+$repo@$rev#subdirectory=core/py"
  "$python" "$dir/py/verify.py" "$vector"

  echo "== C/C++"
  cmake -S "$dir/cpp" -B "$dir/cpp/build" -DCMAKE_BUILD_TYPE=Release -DTHESMOS_REV="$rev" \
    -DTHESMOS_VECTOR="$vector" -DRust_TOOLCHAIN="$(toolchain)"
  cmake --build "$dir/cpp/build" --config Release
  ctest --test-dir "$dir/cpp/build" -C Release --output-on-failure --verbose
}

tag() {
  local version=$arg tagged module
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "not a version: $version" >&2; exit 2; }
  # An annotated tag's ^{} line names its commit; a lightweight tag's own line does.
  tagged=$(git ls-remote "$repo" "refs/tags/v$version" "refs/tags/v$version^{}" | sort -k2 | tail -1 | cut -f1)
  echo "v$version: ${tagged:-missing}"
  # From an empty directory, through the public proxy, as a Go consumer resolves the version.
  module=$(cd "$(mktemp -d)" && GOPROXY=https://proxy.golang.org GOPRIVATE= GONOPROXY= GONOSUMDB= GOFLAGS= \
    go list -m -json "github.com/Bitspark/thesmos/core/go@v$version" |
    sed -n 's/.*"Hash": "\([0-9a-f]\{40\}\)".*/\1/p')
  echo "core/go@v$version (proxy.golang.org): ${module:-missing}"
  [ "$tagged" = "$rev" ] && [ "$module" = "$rev" ] || { echo "the tags do not resolve to $rev" >&2; exit 1; }
}

case $phase in
  prepare) prepare ;;
  verify) verify ;;
  tag) tag ;;
  *) echo "unknown phase: $phase" >&2; exit 2 ;;
esac
