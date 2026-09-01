// Comparison semantics for the questions Rainlytics ships.

import type {
  ReportComparisonDefinition,
  ReportMetricDefinition,
} from "./report-comparison-types.js";
import { vitalEventNames } from "./vital-events.js";

const neutralCount = (
  column: string,
  unit: string,
): ReportMetricDefinition => ({
  column,
  measure: "count",
  unit,
  preference: "neutral",
});

const rankedCounts = (
  question: string,
  metrics: readonly ReportMetricDefinition[],
): ReportComparisonDefinition => ({
  question,
  valueType: "rows",
  rowSet: "ranked",
  metrics,
});

/** Comparison semantics for the report questions exported by Rainlytics. */
export const defaultReportComparisonDefinitions: readonly ReportComparisonDefinition[] =
  [
    rankedCounts("pageviews", [neutralCount("views", "pageviews")]),
    {
      question: "pageviews",
      valueType: "visitor-count",
      rowSet: "complete",
      metrics: [neutralCount("distinct", "visitors")],
    },
    rankedCounts("referrers", [neutralCount("views", "pageviews")]),
    rankedCounts("browsers", [neutralCount("views", "pageviews")]),
    rankedCounts("status-codes", [neutralCount("responses", "responses")]),
    {
      question: "cache-hit-ratio",
      valueType: "rows",
      rowSet: "complete",
      metrics: [
        neutralCount("hits", "requests"),
        neutralCount("misses", "requests"),
        {
          column: "hit_percent",
          measure: "ratio",
          unit: "percent",
          preference: "higher-is-better",
        },
      ],
    },
    rankedCounts("searches", [
      neutralCount("searches", "searches"),
      neutralCount("redirected", "searches"),
    ]),
    rankedCounts("javascript-errors", [neutralCount("errors", "errors")]),
    {
      question: "web-vitals",
      valueType: "rows",
      rowSet: "complete",
      metrics: [
        {
          column: "p75",
          measure: "percentile",
          unit: {
            column: "vital",
            values: {
              [vitalEventNames.largestContentfulPaint]: "milliseconds",
              [vitalEventNames.cumulativeLayoutShift]: "score",
              [vitalEventNames.firstContentfulPaint]: "milliseconds",
              [vitalEventNames.timeToFirstByte]: "milliseconds",
            },
            fallback: "value",
          },
          preference: "lower-is-better",
        },
        neutralCount("samples", "samples"),
      ],
    },
  ];

/** Custom definitions followed by shipped definitions they did not replace. */
export function reportComparisonDefinitions(
  custom: readonly ReportComparisonDefinition[],
): readonly ReportComparisonDefinition[] {
  return [
    ...custom,
    ...defaultReportComparisonDefinitions.filter(
      (shipped) =>
        !custom.some(
          (candidate) =>
            candidate.question === shipped.question &&
            candidate.valueType === shipped.valueType,
        ),
    ),
  ];
}
