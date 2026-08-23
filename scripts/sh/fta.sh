#!/usr/bin/env bash
#
# Report Fast TypeScript Analyzer complexity scores for the source tree.
#
# Thresholds live in fta.json; fta exits non-zero when a file exceeds
# score_cap, which is what makes this usable as a CI gate.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

exec pnpm exec fta . --config-path fta.json
