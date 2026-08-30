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

# Where `bin` points, read from package.json so the two cannot disagree.
bin_path="$(node -e 'process.stdout.write(require("./package.json").bin.rainlytics)')"

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
  # The pages README.md links to with relative paths. Unpacked, those links
  # are dead in node_modules. That is where an agent working in a consumer's
  # repository reads them, and the docs are a few tens of KB against a
  # tarball already carrying dist/ and src/.
  package/docs/command-line/README.md
  package/docs/log-bucket/README.md
  package/docs/log-delivery/README.md
  package/docs/log-table/README.md
  package/docs/query/README.md
  package/docs/query-workgroup/README.md
  package/docs/rollups/README.md
  package/src/index.ts
  package/src/cdk/index.ts
  package/dist/index.js
  package/dist/index.d.ts
  package/dist/cdk/index.js
  package/dist/cdk/index.d.ts
  # The CLI's entry point. `bin` in package.json is a third list that has to
  # agree with `files` and with `exports`, and npm links it onto a consumer's
  # PATH without ever checking the target is there. A missing one shows up as
  # "rainlytics: command not found" after an install that reported success.
  "package/${bin_path#./}"
  # The Lambda deployment package `RollupSummaries` stages as a CDK asset,
  # which is a fourth list. Nothing in `exports` or `bin` reaches it, and the
  # construct finds it by path. A missing one is a synthesis failure in a
  # consumer's own CDK app, long after this published.
  package/dist/lambda/functions/rollup-summary.js
  # The beacon's CloudFront Function source, which `pnpm build` copies into
  # `dist/cdk/` beside the compiled construct. `BeaconPath` reads it by path
  # at synthesis and nothing in `exports` reaches it, so this is the fifth
  # list. A missing one fails a consumer's own `cdk synth`.
  package/dist/cdk/beacon-204.cff.js
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

# The beacon envelope, which has to stand on its own.
#
# `beaconQueryString` is the one thing in this package that runs on every page
# of a measured site. A bundler reaches it through the package root, and the
# root re-exports everything, so what actually decides the page weight is
# which modules the envelope itself pulls in. Its module answers that with
# nothing, and this is what keeps the answer that way.
#
# KensioSoftware/rainlytics#110 is what this is guarding. The SQL reading the
# same parameters back used to sit in the same file, and a minified bundle of
# a beacon-shaped entry carried `url_decode`, `url_extract_parameter` and
# `strpos` that no browser runs. Splitting the file took that bundle from 464
# bytes to 241.
#
# The forbidden-import check above cannot see this. The root legitimately
# reaches SQL, and every one of those imports is a relative path it allows.

envelope="$tmp/package/dist/beacon-events.js"

if [[ ! -f "$envelope" ]]; then
  echo "The beacon envelope is not at dist/beacon-events.js." >&2
  echo "Point this check at wherever beaconQueryString moved to." >&2
  exit 1
fi

envelope_imports="$(
  grep --only-matching --extended-regexp \
    "(from|import)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
    "$envelope" || true
)"

if [[ -n "$envelope_imports" ]]; then
  echo "The beacon envelope imports something:" >&2
  sed 's/^/  /' <<<"$envelope_imports" >&2
  echo >&2
  echo "Every page of a measured site downloads this module. Whatever it" >&2
  echo "imports is downloaded with it, however little of that a browser" >&2
  echo "runs. SQL belongs in dist/beacon-rows.js, which no browser reaches." >&2
  exit 1
fi

# The CLI, run out of the tarball.
#
# Running it proves more than that the file was packed. The extracted tarball
# has no node_modules anywhere above it, so this runs with nothing installed
# but Node itself. `aws-cdk-lib` and `constructs` are optional peer
# dependencies and a CLI-only install has neither, and
# `npx @kensio/rainlytics --help` is expected to work anyway.

packed_bin="$tmp/package/${bin_path#./}"

if ! head -n 1 "$packed_bin" | grep --quiet --fixed-strings '#!/usr/bin/env node'; then
  echo "The bin entry point starts with no node shebang:" >&2
  head -n 1 "$packed_bin" >&2
  echo "npx and a PATH link both run this file directly, and need one." >&2
  exit 1
fi

# Through `node` rather than by executing the file, because the executable bit
# in the tarball is not what decides this. tsc emits 0644 and npm chmods the
# `bin` target to 0755 when it links it, so a check that ran the file directly
# would fail on a package that installs and runs perfectly.
if ! cli_help="$(cd "$tmp/package" && node "$bin_path" --help 2>&1)"; then
  echo "Running $bin_path out of the tarball failed:" >&2
  sed 's/^/  /' <<<"$cli_help" >&2
  echo >&2
  echo "It runs with no dependencies beside it, so anything it imports" >&2
  echo "outside node: and its own relative paths breaks a CLI-only install." >&2
  exit 1
fi

if ! grep --quiet --fixed-strings 'rainlytics <command> [options]' <<<"$cli_help"; then
  echo "$bin_path --help printed nothing that looks like the help:" >&2
  sed 's/^/  /' <<<"$cli_help" >&2
  exit 1
fi

echo "Tarball looks right:"
sed 's/^/  /' <<<"$contents" | sort
