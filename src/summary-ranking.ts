// The order a ranked answer assembled from several windows comes back in.
//
// Apart from `summary-totals.ts` because adding rows up and putting them in
// order are two jobs. One window's rows arrive in the order Athena wrote them
// and are never touched. Several windows produce a pile with no order at all,
// and the question decides what the order should be.
//
// This reproduces the `ORDER BY 2 DESC, 1` and the `LIMIT` a rollup writes for
// one window. A reader comparing this week against last then gets a tie broken
// the same way both times.

import type { SummaryCell, SummaryRow } from "./rollup-summaries.js";
import type { RollupTotals } from "./rollups.js";

/**
 * The rows a ranked question answers with, in order and cut to length.
 *
 * A rollup with no count to rank on keeps the order the windows produced.
 * `cache-hit-ratio` is that case, and it answers with one row.
 */
export function rankedRows(
  rows: readonly SummaryRow[],
  keyColumns: readonly string[],
  totals: RollupTotals,
  limit: number | undefined,
): readonly SummaryRow[] {
  const [ranking] = totals.added;

  if (ranking === undefined || keyColumns.length === 0) {
    return rows;
  }

  // `toSorted` is ES2023 and the compiler targets ES2022, so the copy is
  // taken here and the sort runs over it.
  // oxlint-disable-next-line unicorn/no-array-sort
  const ordered = [...rows].sort(
    (one, other) =>
      counted(other[ranking]) - counted(one[ranking]) ||
      byKeys(one, other, keyColumns),
  );

  return limit === undefined ? ordered : ordered.slice(0, limit);
}

/**
 * Two rows compared on their key columns, in the order they come in.
 *
 * Codepoint order, matching how Athena orders the same column for one window.
 * A locale-aware comparison would put two paths in a different order here from
 * the order a stored window came back in, and a reader comparing this week
 * against last would see the tie move.
 */
function byKeys(
  one: SummaryRow,
  other: SummaryRow,
  keyColumns: readonly string[],
): number {
  for (const column of keyColumns) {
    const here = one[column] ?? "";
    const there = other[column] ?? "";

    if (here !== there) {
      return here < there ? -1 : 1;
    }
  }

  return 0;
}

/** One cell as the number it ranks by, and zero where it holds no number. */
function counted(cell: SummaryCell | undefined): number {
  const value = Number(cell);

  return Number.isFinite(value) ? value : 0;
}
