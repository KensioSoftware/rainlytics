#!/usr/bin/env bash
#
# The contract rainlytics.com's scaffold expects of `docs/`, checked here.
#
# That site copies each `docs/<path>/README.md` to a page, lifts the H1 into
# the title, and reads a trailing `<!-- card -->` comment for the snippet on
# the page's social image. A page missing either one fails the scaffold in the
# *other* repo, at deploy time, long after the change that broke it. This runs
# on every `pnpm check` and reports it in review instead.
#
# The site is not built yet. This is the contract to build it against, and the
# check costs nothing while `docs/` is empty (it exits early).
#
# The docs root README is deliberately exempt. It is an index for people
# browsing this repo on GitHub. The site has its own home page and the
# scaffold leaves this one alone.
#
# Keep the card pattern below in step with `scaffold-docs.mts` there.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [[ ! -d docs ]]; then
  echo "No docs/ directory. Nothing to check."
  exit 0
fi

failures=0

fail() {
  echo "  $1" >&2
  failures=$((failures + 1))
}

while IFS= read -r page; do
  # The docs root index, which the site does not copy.
  if [[ "$page" == "docs/README.md" ]]; then
    continue
  fi

  echo "$page"

  grep --quiet --extended-regexp '^# .+' "$page" ||
    fail "no H1. The site lifts it into the page title."

  # The same pattern scaffold-docs.mts matches with: an HTML comment opening
  # with `card`, wrapping one fenced block.
  perl -0777 -ne '
    exit(/^[^\S\n]*<!--\s*card\s*\n```(\w*)\n([\s\S]*?)\n```\s*-->/m ? 0 : 1)
  ' "$page" ||
    fail "no <!-- card --> block. The site scaffold fails without one."
done < <(find docs -name README.md | sort)

if [[ $failures -gt 0 ]]; then
  echo >&2
  echo "$failures problem(s). See docs/README.md for the contract." >&2
  exit 1
fi

echo
echo "docs/ satisfies the site scaffold's contract."
