// One report section and the accuracy its stored sources allow.

import type { ReportPeriod } from "./report-periods.js";
import { reportSectionSource } from "./report-section-source.js";
import type {
  AvailableReportSectionInput,
  ReportSection,
  ReportSectionInput,
  ReportRowsValue,
  ReportSectionSource,
  UnavailableReportReason,
  UnavailableReportSection,
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

  assertValueMatchesRule(input);
  const source = reportSectionSource(input.sources, period);

  if (!source.complete) {
    return unavailable(input, source, "incomplete-source");
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

  return composedSection(input, source);
}

/** A section composed from several summaries spanning the whole period. */
function composedSection(
  input: AvailableReportSectionInput,
  source: ReportSectionSource,
): ReportSection {
  switch (input.rule) {
    case "additive": {
      return {
        question: input.question,
        accuracy: "exact",
        composition: "additive",
        source,
        value: input.value as ReportRowsValue,
      };
    }
    case "ranked": {
      return {
        question: input.question,
        accuracy: "approximate",
        composition: "ranked-summaries",
        source,
        value: input.value as ReportRowsValue,
      };
    }
    case "visitor-count": {
      return unavailable(input, source, "visitor-counts-do-not-compose");
    }
    case "percentile": {
      return unavailable(input, source, "percentiles-do-not-compose");
    }
  }
}

/** An unavailable section retaining the source that proved it unsafe. */
function unavailable(
  input: AvailableReportSectionInput,
  source: ReportSectionSource,
  reason: UnavailableReportReason,
): UnavailableReportSection {
  return {
    question: input.question,
    accuracy: "unavailable",
    composition: "none",
    reason,
    source,
    // oxlint-disable-next-line unicorn/no-null
    value: null,
  };
}

/** Refuses a visitor count labelled as rows, or rows labelled as a count. */
function assertValueMatchesRule(input: AvailableReportSectionInput): void {
  const visitorRule = input.rule === "visitor-count";
  const visitorValue = input.value.type === "visitor-count";

  if (visitorRule !== visitorValue) {
    throw new TypeError(
      `A ${input.rule} report section cannot carry a` +
        ` ${input.value.type} value.`,
    );
  }
}
