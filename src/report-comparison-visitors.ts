// Comparing the distinct visitor values carried outside report rows.

import { availableMetric } from "./report-comparison-changes.js";
import { comparisonAccuracy } from "./report-comparison-section-sources.js";
import type {
  AvailableReportSectionComparison,
  ReportComparisonDefinition,
  ReportComparisonSectionSources,
} from "./report-comparison-types.js";
import type {
  ReportSection,
  ReportVisitorValue,
} from "./report-section-types.js";

/** Compares the distinct count carried outside row values. */
export function comparedVisitors(
  current: Exclude<ReportSection, { readonly accuracy: "unavailable" }>,
  previous: Exclude<ReportSection, { readonly accuracy: "unavailable" }>,
  currentValue: ReportVisitorValue,
  previousValue: ReportVisitorValue,
  definition: ReportComparisonDefinition,
  sources: ReportComparisonSectionSources,
): AvailableReportSectionComparison {
  const metric = definition.metrics[0];

  if (metric === undefined) {
    throw new RangeError(
      `The ${definition.question} visitor comparison defines no metric.`,
    );
  }

  return {
    ...sources,
    status: "available",
    valueType: "visitor-count",
    accuracy: comparisonAccuracy(current, previous),
    metrics: [
      availableMetric(
        {},
        metric,
        currentValue.count.distinct,
        previousValue.count.distinct,
      ),
    ],
  };
}
