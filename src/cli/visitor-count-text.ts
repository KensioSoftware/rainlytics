// One window's visitor count, as standard error says it.
//
// Apart from `summary-report.ts`, which says everything else about what a
// command read, for the complexity budget that file sits at.

import type { VisitorCount } from "../rollup-summaries.js";

/**
 * The visitors one window saw, and the ones `renderedOnly` left out where
 * the count carries them.
 *
 * Said wherever the count has it. A filter dropping people nobody can see is
 * the failure that number exists to show.
 */
export function visitorCountText(visitors: VisitorCount): string {
  const left =
    visitors.unrendered === undefined
      ? ""
      : `, leaving out ${String(visitors.unrendered)} who rendered no page`;

  return `${String(visitors.distinct)} visitors in that window${left}.\n`;
}
