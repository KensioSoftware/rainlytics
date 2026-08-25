#!/usr/bin/env bash
#
# What `pnpm publish` would actually upload, checked before it can be uploaded.
#
# `files` in package.json and the `exports` map are two lists that have to
# agree and nothing else makes them. A path can be exported and not packed,
# and the failure shows up as a bare "Cannot find module" for whoever installs
# it. That is the wrong place to find out, so it is found out here.
#
# The second check below is why the entry points are separate. `./beacon` is
# bundled into a site's own JavaScript and the package root is reachable from
# it, so a stray import of `aws-cdk-lib` or of a Node built-in from either one
# breaks the bundler or drags a megabyte of CDK into a page whose whole point
# is that it downloads nothing extra. `./cdk` is exempt, being the entry point
# that exists to hold exactly those imports.
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
  # The construct pages. README.md ships and links to these with relative
  # paths, and unpacked those links are dead in node_modules. That is where
  # an agent working in a consumer's repository reads them, and the docs are
  # 17KB against a tarball already carrying dist/ and src/.
  package/docs/log-bucket/README.md
  package/docs/log-delivery/README.md
  package/src/index.ts
  package/src/cdk/index.ts
  package/dist/index.js
  package/dist/index.d.ts
  package/dist/cdk/index.js
  package/dist/cdk/index.d.ts
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

# What the browser-facing half of the tarball imports, read out of the built
# JavaScript rather than the source. A re-export chain that reaches CDK
# through the package root is the way this happens, and it is invisible in any
# one source file.
tar --extract --file "$tarball" --directory "$tmp"

# The root module, and the beacon once it exists. `./cdk` is deliberately not
# on this list.
browser_reachable=("$tmp/package/dist/index.js")
if [[ -d "$tmp/package/dist/beacon" ]]; then
  browser_reachable+=("$tmp/package/dist/beacon")
fi

# Three import forms reach a module specifier, and only the first carries a
# `from`:
#
#     import { x } from "spec"     export * from "spec"
#     import "spec"                 side effect, no binding
#     import("spec")                dynamic
#
# An earlier version of this matched `from` alone, and both of the others
# walked past it. That is the failure mode this whole file argues against: a
# guard that passes silently reads like one that ran.
#
# `--only-matching` leaves one specifier construct per line for sed to strip.
# The pattern errs towards matching, so a stray "import" inside a string
# literal can produce a false positive. That direction is the safe one. A
# false positive fails loudly and takes a minute to dismiss, and a false
# negative is a megabyte of CDK in somebody's page.
#
# `|| true` because a module that imports nothing at all is a pass, and grep
# reports that as exit 1 like any other empty result.
browser_imports="$(
  {
    grep --recursive --no-filename --only-matching --extended-regexp \
      "(from|import)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
      "${browser_reachable[@]}" --include='*.js' || true
  } |
    sed -E "s/.*[\"']([^\"']+)[\"'].*/\1/" |
    sort --unique
)"

forbidden="$(grep --extended-regexp '^(node:|aws-cdk-lib|constructs)' <<<"$browser_imports" || true)"

if [[ -n "$forbidden" ]]; then
  echo "Browser-reachable code imports things a browser has no use for:" >&2
  sed 's/^/  /' <<<"$forbidden" >&2
  echo >&2
  echo "Checked: ${browser_reachable[*]#"$tmp/package/"}" >&2
  echo "This ships inside a site's own bundle. Keep it to what a browser has." >&2
  echo "CDK imports belong under src/cdk, behind the ./cdk export." >&2
  exit 1
fi

echo "Tarball looks right:"
sed 's/^/  /' <<<"$contents" | sort
