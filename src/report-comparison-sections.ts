// Pairing compatible sections from two stored calendar reports.

import type {
  ReportComparisonDefinition,
  ReportSectionComparison,
} from "./report-comparison-types.js";
import {
  comparisonAccuracy,
  comparisonSectionSources,
} from "./report-comparison-section-sources.js";
import { sameReportValue } from "./report-comparison-json.js";
import { comparedRows } from "./report-comparison-values.js";
import { comparedVisitors } from "./report-comparison-visitors.js";
import type { ReportPeriod } from "./report-periods.js";
import type { ReportSection } from "./report-section-types.js";

// oxlint-disable-next-line unicorn/no-null
const absent = null;

/** One pair of report sections, compared or withheld with a reason. */
export function comparedSection(
  current: ReportSection | undefined,
  previous: ReportSection | undefined,
  currentPeriod: ReportPeriod,
  previousPeriod: ReportPeriod,
  definitions: readonly ReportComparisonDefinition[],
): ReportSectionComparison {
  const sources = comparisonSectionSources(current, previous);

  if (current === undefined || previous === undefined) {
    return { ...sources, status: "unavailable", reason: "section-absent" };
  }

  if (!sameReportValue(current.question, previous.question)) {
    return { ...sources, status: "unavailable", reason: "question-mismatch" };
  }

  if (
    incompleteSection(current, currentPeriod) ||
    incompleteSection(previous, previousPeriod)
  ) {
    return { ...sources, status: "unavailable", reason: "incomplete-source" };
  }

  if (
    current.accuracy === "unavailable" ||
    previous.accuracy === "unavailable"
  ) {
    return { ...sources, status: "unavailable", reason: "section-unavailable" };
  }

  if (current.value.type !== previous.value.type) {
    return { ...sources, status: "unavailable", reason: "value-type-mismatch" };
  }

  const definition = definitions.find(
    (candidate) =>
      candidate.question === current.question.name &&
      candidate.valueType === current.value.type,
  );

  if (definition === undefined) {
    return {
      ...sources,
      status: "unavailable",
      reason: "unsupported-question",
    };
  }

  if (
    current.value.type === "visitor-count" &&
    previous.value.type === "visitor-count"
  ) {
    return comparedVisitors(
      current,
      previous,
      current.value,
      previous.value,
      definition,
      sources,
    );
  }

  if (
    current.value.type !== "rows" ||
    previous.value.type !== "rows" ||
    !sameReportValue(current.value.columns, previous.value.columns)
  ) {
    return { ...sources, status: "unavailable", reason: "columns-mismatch" };
  }

  const currentValue = current.value;
  const previousValue = previous.value;

  if (
    !definition.metrics.every((metric) =>
      currentValue.columns.includes(metric.column),
    )
  ) {
    return { ...sources, status: "unavailable", reason: "columns-mismatch" };
  }

  return {
    ...sources,
    status: "available",
    valueType: "rows",
    accuracy: comparisonAccuracy(current, previous),
    metrics: comparedRows(currentValue, previousValue, definition),
  };
}

/** Whether a section's source spans its whole report period. */
function incompleteSection(
  section: ReportSection,
  period: ReportPeriod,
): boolean {
  return (
    section.source !== absent &&
    (!section.source.complete ||
      section.source.from !== period.from ||
      section.source.until !== period.until)
  );
}
