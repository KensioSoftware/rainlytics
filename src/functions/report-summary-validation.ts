// Checking persisted summary JSON before report arithmetic uses it.

import type {
  RollupSummary,
  SummaryQuestion,
  SummaryRow,
} from "../rollup-summaries.js";
import { summarySchemaVersion } from "../rollup-summaries.js";
import type { SummarySpan } from "../summary-windows.js";

/** Whether persisted JSON is the expected summary and has complete rows. */
export function isExpectedSummary(
  candidate: unknown,
  question: SummaryQuestion,
  span: SummarySpan,
): candidate is RollupSummary {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const found = candidate as Partial<RollupSummary>;
  const columns = found.columns;
  const rows = found.rows;

  return (
    found.schemaVersion === summarySchemaVersion &&
    JSON.stringify(found.question) === JSON.stringify(question) &&
    found.window?.from === span.from &&
    found.window.until === span.until &&
    Array.isArray(columns) &&
    columns.every((column) => typeof column === "string") &&
    Array.isArray(rows) &&
    rows.every((row) => isSummaryRow(row, columns))
  );
}

/** Whether persisted JSON is one complete row under the declared columns. */
function isSummaryRow(
  candidate: unknown,
  columns: readonly string[],
): candidate is SummaryRow {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return false;
  }

  const row = candidate as Record<string, unknown>;

  return (
    Object.keys(row).length === columns.length &&
    columns.every(
      (column) =>
        Object.hasOwn(row, column) &&
        (typeof row[column] === "string" || row[column] === null),
    )
  );
}
