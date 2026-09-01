// Formatting comparison metrics for a plain-text report notification.

import type { ReportMetricComparison } from "./report-comparison-types.js";

/** Comparison metrics grouped into the rows they describe. */
export function reportNotificationMetricLines(
  metrics: readonly ReportMetricComparison[],
  maxRows: number,
): readonly string[] {
  const rows = new Map<string, ReportMetricComparison[]>();

  for (const metric of metrics) {
    if (metric.current === null) {
      continue;
    }

    const key = JSON.stringify(metric.row);
    const row = rows.get(key) ?? [];
    row.push(metric);
    rows.set(key, row);
  }

  if (rows.size === 0) {
    return ["  No rows."];
  }

  const selected = [...rows.values()].slice(0, maxRows);
  const lines = selected.map((row) => {
    const label = rowLabel(row[0]?.row ?? {});
    const values = row.map((metric) => metricText(metric)).join(", ");
    return `  ${label === "" ? values : `${label}: ${values}`}`;
  });

  if (rows.size > selected.length) {
    lines.push(`  ${String(rows.size - selected.length)} more rows omitted.`);
  }

  return lines;
}

/** One metric's current value and its adjacent-period change. */
function metricText(metric: ReportMetricComparison): string {
  if (metric.current === null) {
    return `${metric.metric} unavailable`;
  }

  const value = `${metric.metric} ${formatNumber(metric.current)} ${metric.unit}`;
  if (metric.status === "unavailable") {
    return `${value} (comparison unavailable)`;
  }

  const assessment =
    metric.assessment === "improvement" || metric.assessment === "regression"
      ? `, ${metric.assessment}`
      : "";

  if (metric.change.value === null) {
    return `${value} (change unavailable from zero baseline${assessment})`;
  }

  const change =
    metric.change.type === "percentage-points"
      ? `${signed(metric.change.value)} percentage points`
      : `${signed(metric.change.value)}%`;

  return `${value} (${change}${assessment})`;
}

/** Stable identity cells for one report row. */
function rowLabel(row: Readonly<Record<string, string | null>>): string {
  return Object.entries(row)
    .filter(([, value]) => value !== null)
    .map(([column, value]) => `${column}=${String(value)}`)
    .join(", ");
}

/** A signed change rounded to one decimal place without a trailing zero. */
function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const normal = Object.is(rounded, -0) ? 0 : rounded;
  return `${normal > 0 ? "+" : ""}${String(normal)}`;
}

/** A current value rounded to two decimal places where needed. */
function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100);
}
