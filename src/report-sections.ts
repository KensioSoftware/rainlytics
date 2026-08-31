// One report section and the accuracy its stored sources allow.

import type { ReportPeriod } from "./report-periods.js";
import {
  assertReportValueMatchesRule,
  composedReportSection,
  unavailableReportSection,
} from "./report-section-composition.js";
import {
  reportPeriodQuerySource,
  reportSectionSource,
} from "./report-section-source.js";
import type {
  ReportSection,
  ReportSectionInput,
} from "./report-section-types.js";

/**
 * Builds a section and assigns the only safe accuracy for its sources.
 *
 * A single summary spanning the report is exact for every rule. Counts add
 * exactly across a complete set of summaries. Ranked rows are approximate
 * because each source was truncated before composition. Visitor counts and
 * percentiles are unavailable across several summaries.
 */
export function reportSection(
  input: ReportSectionInput,
  period: ReportPeriod,
): ReportSection {
  if (input.rule === "missing") {
    return {
      question: input.question,
      accuracy: "unavailable",
      composition: "none",
      reason: "missing-rollup",
      // oxlint-disable-next-line unicorn/no-null
      source: null,
      // oxlint-disable-next-line unicorn/no-null
      value: null,
    };
  }

  assertReportValueMatchesRule(input);
  const source =
    input.calculation === "period-query"
      ? reportPeriodQuerySource(input.sources, period)
      : reportSectionSource(input.sources, period);

  if (!source.complete) {
    return unavailableReportSection(input, source, "incomplete-source");
  }

  if (input.calculation === "period-query") {
    return {
      question: input.question,
      accuracy: "exact",
      composition: "period-query",
      source,
      value: input.value,
    };
  }

  if (source.summaries === 1) {
    return {
      question: input.question,
      accuracy: "exact",
      composition: "single-summary",
      source,
      value: input.value,
    };
  }

  return composedReportSection(input, source);
}
