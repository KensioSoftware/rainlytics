// Several stored windows, added into one answer.
//
// Apart from `rollup-summaries.ts` because that module describes a document
// and this does arithmetic over a pile of them. Apart from `summary-coverage.ts`
// because choosing the windows and adding them up are two jobs, and a reader
// who found a gap in the coverage never reaches this.
//
// What a rollup declares in `RollupTotals` decides the arithmetic. A column
// named there adds, a column derived from those is worked out again, and
// everything else names a row. `docs/summaries/` has the reasoning and the
// three things that go wrong where a reader adds summaries up by hand.
//
// Nothing here reaches for the AWS SDK. It is rows.

import type {
  RollupSummary,
  SummaryCell,
  SummaryRow,
} from "./rollup-summaries.js";
import type { RollupTotals } from "./rollups.js";
import { rankedRows } from "./summary-ranking.js";

/** What a cell holding no value is. */
// oxlint-disable-next-line unicorn/no-null
const absent = null;

/** The rows of several windows, matched on their keys and added up. */
interface Totalled {
  /** The cells naming the row, in the order the columns come in. */
  readonly keys: SummaryRow;

  /** The counts, added across every window that held this row. */
  readonly added: Record<string, number>;
}

/**
 * One answer over several stored windows.
 *
 * Rows are matched on every column the rollup did not name as a count. The
 * counts add, the derived columns are worked out again from the sums, and the
 * result comes back in the column order the summaries were written with.
 *
 * A ranked question is ordered by its first count, highest first, with the
 * keys breaking a tie. That is the `ORDER BY 2 DESC, 1` a rollup writes for
 * one window, applied again over the sum of several. The ranking is
 * approximate, because a row outside the stored rows of every window is
 * missing from all of them. Whatever reads this says so.
 *
 * @throws {RangeError} where there is nothing to add, since the columns come
 *   from the summaries and an empty pile names none.
 */
export function totalledRows(
  summaries: readonly RollupSummary[],
  totals: RollupTotals,
  limit?: number,
): readonly SummaryRow[] {
  const [first] = summaries;

  if (first === undefined) {
    throw new RangeError(
      "Adding up no summaries answers nothing. A reader that found no" +
        " window reports that instead.",
    );
  }

  const keyColumns = first.columns.filter(
    (column) => !isCounted(column, totals),
  );
  const collected = new Map<string, Totalled>();

  for (const summary of summaries) {
    for (const row of summary.rows) {
      collect(collected, row, keyColumns, totals);
    }
  }

  const rows = [...collected.values()].map((totalled) =>
    written(totalled, first.columns, totals),
  );

  return rankedRows(rows, keyColumns, totals, limit);
}

/** Whether a column holds a count or something worked out from the counts. */
function isCounted(column: string, totals: RollupTotals): boolean {
  return totals.added.includes(column) || column in (totals.recomputed ?? {});
}

/** Adds one window's row into whatever the earlier windows left. */
function collect(
  collected: Map<string, Totalled>,
  row: SummaryRow,
  keyColumns: readonly string[],
  totals: RollupTotals,
): void {
  const keys = Object.fromEntries(
    keyColumns.map((column) => [column, row[column] ?? absent]),
  );
  const at = JSON.stringify(keyColumns.map((column) => keys[column]));
  const found = collected.get(at) ?? {
    keys,
    added: Object.fromEntries(totals.added.map((column) => [column, 0])),
  };

  for (const column of totals.added) {
    found.added[column] = (found.added[column] ?? 0) + counted(row[column]);
  }

  collected.set(at, found);
}

/**
 * One cell as the number it counts.
 *
 * Every cell in a summary is text, since every column in the log table is.
 * A cell holding something no count could be reads as zero, which keeps one
 * malformed row out of the whole column's total.
 */
function counted(cell: SummaryCell | undefined): number {
  const value = Number(cell);

  return Number.isFinite(value) ? value : 0;
}

/** One totalled row, written out in the order the columns come in. */
function written(
  totalled: Totalled,
  columns: readonly string[],
  totals: RollupTotals,
): SummaryRow {
  return Object.fromEntries(
    columns.map((column) => [column, cellFor(column, totalled, totals)]),
  );
}

/**
 * One cell of a totalled row.
 *
 * The derived columns are asked first, and a function answering `null` is
 * taken at its word. `cache-hit-ratio` over windows nothing was served in is
 * that case, and a percentage of no requests has no value to print.
 */
function cellFor(
  column: string,
  totalled: Totalled,
  totals: RollupTotals,
): SummaryCell {
  const recomputed = totals.recomputed ?? {};

  if (column in recomputed) {
    return recomputed[column]?.(totalled.added) ?? absent;
  }

  return totals.added.includes(column)
    ? String(totalled.added[column] ?? 0)
    : (totalled.keys[column] ?? absent);
}
