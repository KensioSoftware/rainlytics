#!/usr/bin/env bash
#
# What `pnpm publish` would actually upload, checked before it can be uploaded.
#
# `files` in package.json and the `exports` map are two lists that have to
# agree and nothing else makes them. A path can be exported and not packed,
# and the failure shows up as a bare "Cannot find module" for whoever installs
# it. That is the wrong place to find out, so it is found out here.
#
# The second check below guards the beacon. That code is bundled into a site's
# own JavaScript, and a stray import of `aws-cdk-lib` or of a Node built-in
# from `src/beacon` either breaks the bundler or drags a megabyte of CDK into
# a page whose whole point is that it downloads nothing extra. It skips while
# that directory is still to be written.
#
# Run by `pnpm check` and by the build job in both workflows.

set -euo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Builds the tarball for real. prepack runs, so this is the same dist/ a
# publish would ship, and it lands somewhere the repository will not notice.
tarball="$(pnpm pack --pack-destination "$tmp" | tail -n 1)"

contents="$(tar --list --file "$tarball")"

# npm rewrites every path in a tarball under `package/`.
expected=(
  package/package.json
  package/README.md
  package/LICENSE
  package/src/index.ts
  package/dist/index.js
  package/dist/index.d.ts
)

missing=()
for path in "${expected[@]}"; do
  grep --quiet --line-regexp --fixed-strings "$path" <<<"$contents" ||
    missing+=("$path")
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing from the tarball:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo >&2
  echo "What is in it:" >&2
  sed 's/^/  /' <<<"$contents" >&2
  exit 1
fi

# The build emits `declarationMap` and `sourceMap`, and both point at `src`,
# so `src` is packed alongside `dist` and go-to-definition lands on the real
# source. Tests live beside the code they test, and the negation in `files`
# keeps those out. Nothing else does, so it is worth checking.
if grep --quiet --extended-regexp 'package/(dist|src)/.*\.(test|spec)\.' <<<"$contents"; then
  echo "Test files reached the tarball:" >&2
  grep --extended-regexp 'package/(dist|src)/.*\.(test|spec)\.' <<<"$contents" >&2
  exit 1
fi

# What the beacon half of the tarball imports, read out of the built
# JavaScript rather than the source. A re-export chain that reaches CDK
# through the package root is the way this happens, and it is invisible in any
# one source file.
tar --extract --file "$tarball" --directory "$tmp"

if [[ ! -d "$tmp/package/dist/beacon" ]]; then
  echo "Tarball looks right (no beacon to check yet):"
  sed 's/^/  /' <<<"$contents" | sort
  exit 0
fi

# `|| true` because a beacon that imports nothing at all is a pass, and grep
# reports that as exit 1 like any other empty result.
beacon_imports="$(
  {
    grep --recursive --no-filename --extended-regexp \
      "from[[:space:]]+[\"'][^\"']+[\"']" \
      "$tmp/package/dist/beacon" --include='*.js' || true
  } |
    sed -E "s/.*from[[:space:]]+[\"']([^\"']+)[\"'].*/\1/" |
    sort --unique
)"

forbidden="$(grep --extended-regexp '^(node:|aws-cdk-lib|constructs)' <<<"$beacon_imports" || true)"

if [[ -n "$forbidden" ]]; then
  echo "The beacon imports things a browser has no use for:" >&2
  sed 's/^/  /' <<<"$forbidden" >&2
  echo >&2
  echo "It ships inside a site's own bundle. Keep it to what a browser has." >&2
  exit 1
fi

echo "Tarball looks right:"
sed 's/^/  /' <<<"$contents" | sort
