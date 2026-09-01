// Source metadata and accuracy for a report section comparison.

import type {
  ReportComparisonSectionSource,
  ReportComparisonSectionSources,
} from "./report-comparison-types.js";
import type { ReportSection } from "./report-section-types.js";

// oxlint-disable-next-line unicorn/no-null
const absent = null;

/** Questions and section source metadata for both sides. */
export function comparisonSectionSources(
  current: ReportSection | undefined,
  previous: ReportSection | undefined,
): ReportComparisonSectionSources {
  return {
    questions: {
      current: current?.question ?? absent,
      previous: previous?.question ?? absent,
    },
    current: current === undefined ? absent : sectionSource(current),
    previous: previous === undefined ? absent : sectionSource(previous),
  };
}

/** Carries approximation forward from either source section. */
export function comparisonAccuracy(
  current: Exclude<ReportSection, { readonly accuracy: "unavailable" }>,
  previous: Exclude<ReportSection, { readonly accuracy: "unavailable" }>,
): "exact" | "approximate" {
  return current.accuracy === "approximate" ||
    previous.accuracy === "approximate"
    ? "approximate"
    : "exact";
}

/** Source metadata from one stored section. */
function sectionSource(section: ReportSection): ReportComparisonSectionSource {
  return {
    accuracy: section.accuracy,
    composition: section.composition,
    source: section.source,
  };
}
