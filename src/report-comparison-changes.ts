// Arithmetic and interpretation for one report metric comparison.

import type {
  AvailableReportMetricComparison,
  ReportMetricAssessment,
  ReportMetricDefinition,
  ReportMetricTrend,
} from "./report-comparison-types.js";
import type { SummaryRow } from "./rollup-summaries.js";

// oxlint-disable-next-line unicorn/no-null
const absent = null;

/** A metric comparison with both numeric values present. */
export function availableMetric(
  row: SummaryRow,
  metric: ReportMetricDefinition,
  current: number,
  previous: number,
  selectedUnit: string = reportMetricUnit(metric, row),
): AvailableReportMetricComparison {
  const difference = current - previous;
  const trend = trendOf(difference);

  return {
    status: "available",
    row,
    metric: metric.column,
    measure: metric.measure,
    unit: selectedUnit,
    preference: metric.preference,
    current,
    previous,
    difference,
    change:
      metric.measure === "ratio"
        ? { type: "percentage-points", value: difference }
        : previous === 0
          ? { type: "relative-percent", value: absent, reason: "zero-baseline" }
          : {
              type: "relative-percent",
              value: (100 * difference) / Math.abs(previous),
            },
    trend,
    assessment: assessmentOf(trend, metric.preference),
  };
}

/** The unit a metric definition assigns to one row. */
export function reportMetricUnit(
  metric: ReportMetricDefinition,
  row: SummaryRow,
): string {
  if (typeof metric.unit === "string") {
    return metric.unit;
  }

  const key = row[metric.unit.column];
  return key === absent || key === undefined
    ? metric.unit.fallback
    : (metric.unit.values[key] ?? metric.unit.fallback);
}

/** Numeric movement without a value judgement. */
function trendOf(difference: number): ReportMetricTrend {
  return difference > 0
    ? "increase"
    : difference < 0
      ? "decrease"
      : "unchanged";
}

/** Movement interpreted through a metric's preferred direction. */
function assessmentOf(
  trend: ReportMetricTrend,
  preference: ReportMetricDefinition["preference"],
): ReportMetricAssessment {
  if (trend === "unchanged") {
    return "unchanged";
  }

  if (preference === "neutral") {
    return "unrated";
  }

  return (trend === "increase") === (preference === "higher-is-better")
    ? "improvement"
    : "regression";
}
