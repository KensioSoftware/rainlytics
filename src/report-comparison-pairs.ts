// Pairing report sections by question name and occurrence.

import { comparedSection } from "./report-comparison-sections.js";
import type {
  ReportComparisonDefinition,
  ReportSectionComparison,
} from "./report-comparison-types.js";
import type { ReportDocument } from "./report-document.js";
import type { ReportSection } from "./report-section-types.js";

interface IndexedSection {
  readonly key: string;
  readonly section: ReportSection;
}

/** Sections paired by question name and occurrence within that question. */
export function comparedSections(
  current: ReportDocument,
  previous: ReportDocument,
  definitions: readonly ReportComparisonDefinition[],
): readonly ReportSectionComparison[] {
  const currentSections = indexedSections(current.sections);
  const previousSections = indexedSections(previous.sections);
  const currentByKey = new Map(
    currentSections.map((indexed) => [indexed.key, indexed.section]),
  );
  const previousByKey = new Map(
    previousSections.map((indexed) => [indexed.key, indexed.section]),
  );
  const keys = [
    ...currentSections.map((indexed) => indexed.key),
    ...previousSections
      .map((indexed) => indexed.key)
      .filter((key) => !currentByKey.has(key)),
  ];

  return keys.map((key) =>
    comparedSection(
      currentByKey.get(key),
      previousByKey.get(key),
      current.period,
      previous.period,
      definitions,
    ),
  );
}

/** Gives repeated row and visitor sections separate stable identities. */
function indexedSections(
  sections: readonly ReportSection[],
): readonly IndexedSection[] {
  const occurrences = new Map<string, number>();

  return sections.map((section) => {
    const name = section.question.name;
    const occurrence = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    return { key: `${name}\u0000${String(occurrence)}`, section };
  });
}
