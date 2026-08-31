// Accuracy decisions for report values built from complete sources.

import type {
  AvailableReportSectionInput,
  ReportRowsValue,
  ReportSection,
  ReportSectionSource,
  UnavailableReportReason,
  UnavailableReportSection,
} from "./report-section-types.js";

/** A section composed from several summaries spanning the whole period. */
export function composedReportSection(
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
      return unavailableReportSection(
        input,
        source,
        "visitor-counts-do-not-compose",
      );
    }
    case "percentile": {
      return unavailableReportSection(
        input,
        source,
        "percentiles-do-not-compose",
      );
    }
  }
}

/** An unavailable section retaining the source that proved it unsafe. */
export function unavailableReportSection(
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
export function assertReportValueMatchesRule(
  input: AvailableReportSectionInput,
): void {
  const visitorRule = input.rule === "visitor-count";
  const visitorValue = input.value.type === "visitor-count";

  if (visitorRule !== visitorValue) {
    throw new TypeError(
      `A ${input.rule} report section cannot carry a` +
        ` ${input.value.type} value.`,
    );
  }
}
