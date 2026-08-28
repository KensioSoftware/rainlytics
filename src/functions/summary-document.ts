// One answer, turned into the document that lands on S3.
//
// Apart from the handler because the two do different jobs. The handler runs
// queries and writes objects, and this decides what one object holds. It
// reaches for nothing outside the package.

import type { AthenaOutcome } from "../athena/athena-outcome.js";
import type {
  RollupSummary,
  SummaryQuestion,
  SummaryRow,
  VisitorCount,
} from "../rollup-summaries.js";
import { summarySchemaVersion } from "../rollup-summaries.js";
import type { SummaryWindow } from "../summary-windows.js";
import { summarySpan } from "../summary-windows.js";

/**
 * The summary one query answered with.
 *
 * A query that found nothing still produces a document. "No traffic in this
 * window" and "nobody has computed this window" are different answers, and a
 * run that skipped writing an empty one would leave them as the same 404 for
 * every reader. `docs/summaries/` has the three cases a reader meets.
 *
 * The columns come from what Athena declared rather than from the rows, so an
 * empty answer still names what it was looking for.
 *
 * The visitor count comes from a second query and is left out where the
 * question counts something else. Absent and `{ distinct: 0 }` are different
 * answers, and the key is missing rather than null so that a reader can tell
 * them apart.
 */
export function summaryDocument(
  question: SummaryQuestion,
  window: SummaryWindow,
  outcome: AthenaOutcome,
  computedAt: Date,
  visitors?: VisitorCount,
): RollupSummary {
  return {
    schemaVersion: summarySchemaVersion,
    question,
    window: summarySpan(window),
    computedAt: computedAt.toISOString(),
    columns: outcome.columns.map((column) => column.name),
    rows: outcome.rows.map((row) => storedRow(row)),
    ...(visitors === undefined ? {} : { visitors }),
  };
}

/**
 * One row as JSON holds it.
 *
 * The SDK reports a cell Athena left out as `undefined`, and `JSON.stringify`
 * drops a key whose value is that. A reader would then meet a row missing a
 * column it can see in `columns`. `null` survives the round trip and says the
 * same thing.
 */
function storedRow(
  row: Readonly<Record<string, string | undefined>>,
): SummaryRow {
  return Object.fromEntries(
    Object.entries(row).map(([column, cell]) => [column, cell ?? absent]),
  );
}

/** What a cell Athena left out becomes. */
// oxlint-disable-next-line unicorn/no-null
const absent = null;
