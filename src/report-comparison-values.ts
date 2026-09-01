// Matching report rows and comparing their numeric values.

import type {
  ReportComparisonDefinition,
  ReportMetricComparison,
  ReportMetricDefinition,
} from "./report-comparison-types.js";
import {
  availableMetric,
  reportMetricUnit,
} from "./report-comparison-changes.js";
import type { ReportRowsValue } from "./report-section-types.js";
import type { SummaryRow } from "./rollup-summaries.js";

// oxlint-disable-next-line unicorn/no-null
const absent = null;

/** Compares rows matched on every non-metric column. */
export function comparedRows(
  current: ReportRowsValue,
  previous: ReportRowsValue,
  definition: ReportComparisonDefinition,
): readonly ReportMetricComparison[] {
  const metricColumns = new Set(
    definition.metrics.map((metric) => metric.column),
  );
  const keyColumns = current.columns.filter(
    (column) => !metricColumns.has(column),
  );
  const currentRows = rowsByKey(current.rows, keyColumns);
  const previousRows = rowsByKey(previous.rows, keyColumns);
  const keys = [
    ...currentRows.keys(),
    ...[...previousRows.keys()].filter((key) => !currentRows.has(key)),
  ];

  return keys.flatMap((key) => {
    const currentRow = currentRows.get(key);
    const previousRow = previousRows.get(key);
    const row = rowKey(currentRow ?? previousRow ?? {}, keyColumns);

    return definition.metrics.map((metric) =>
      comparedRowMetric(
        row,
        metric,
        currentRow,
        previousRow,
        definition.rowSet,
      ),
    );
  });
}

/** Rows addressed by the ordered cells that identify them. */
function rowsByKey(
  rows: readonly SummaryRow[],
  columns: readonly string[],
): ReadonlyMap<string, SummaryRow> {
  return new Map(
    rows.map((row) => [
      JSON.stringify(columns.map((column) => row[column])),
      row,
    ]),
  );
}

/** The non-metric cells that identify one row. */
function rowKey(row: SummaryRow, columns: readonly string[]): SummaryRow {
  return Object.fromEntries(
    columns.map((column) => [column, row[column] ?? absent]),
  );
}

/** One metric from matched or unmatched rows. */
function comparedRowMetric(
  row: SummaryRow,
  metric: ReportMetricDefinition,
  currentRow: SummaryRow | undefined,
  previousRow: SummaryRow | undefined,
  rowSet: ReportComparisonDefinition["rowSet"],
): ReportMetricComparison {
  const current = numericCell(currentRow?.[metric.column]);
  const previous = numericCell(previousRow?.[metric.column]);
  const unit = reportMetricUnit(metric, currentRow ?? previousRow ?? {});

  if (current === absent || previous === absent) {
    return {
      status: "unavailable",
      reason:
        currentRow === undefined || previousRow === undefined
          ? rowSet === "ranked"
            ? "ranked-row-absent"
            : "row-absent"
          : "metric-value-unavailable",
      row,
      metric: metric.column,
      measure: metric.measure,
      unit,
      preference: metric.preference,
      current,
      previous,
    };
  }

  return availableMetric(row, metric, current, previous, unit);
}

/** A stored numeric cell, excluding null, empty and non-finite values. */
function numericCell(value: string | null | undefined): number | null {
  if (value === absent || value === undefined || value.trim() === "") {
    return absent;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : absent;
}
