// How each of the five questions adds up across stored summaries.
//
// Apart from `rollup-questions.ts`, which writes the SQL. A question is
// answered two ways and both are the question's own. Athena counts one window
// from raw, and a reader asking about seven days adds 29 of those together.
//
// The counts add and the keys match. `hit_percent` is the one column that does
// neither, and the arithmetic for it is below.

import type { RollupTotals } from "./rollups.js";

/** Views by path, added by path. */
export const pageviewTotals: RollupTotals = { added: ["views"] };

/** Views by referring host, added by host. */
export const referrerTotals: RollupTotals = { added: ["views"] };

/** Responses by status, added by status. */
export const statusTotals: RollupTotals = { added: ["responses"] };

/** Searches and redirects, added by term and by the section it was typed in. */
export const searchTotals: RollupTotals = {
  added: ["searches", "redirected"],
};

/**
 * The hit percentage of hits and misses already added up.
 *
 * The same arithmetic as the `round(100.0 * ... , 1)` in the query, for a
 * reader assembling several stored windows into one answer. Two windows'
 * percentages averaged say nothing about either, and the counts underneath
 * them are what add.
 *
 * A window in which the cache was never asked has no percentage. That is what
 * `nullif` answers in the query and what `null` answers here.
 */
function hitPercent(added: Readonly<Record<string, number>>): string | null {
  const hits = Number(added["hits"]);
  const decided = hits + Number(added["misses"]);

  // oxlint-disable-next-line unicorn/no-null
  return decided > 0 ? ((100 * hits) / decided).toFixed(1) : null;
}

/** Hits and misses added, and the percentage worked out again from them. */
export const cacheTotals: RollupTotals = {
  added: ["hits", "misses"],
  recomputed: { hit_percent: hitPercent },
};
