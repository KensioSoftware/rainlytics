// The source span represented by all sections in a report document.

import type { ReportPeriod } from "./report-periods.js";
import type {
  ReportSection,
  ReportSectionSource,
} from "./report-section-types.js";

/** The source span covered by the document as a whole. */
export interface ReportSourceCoverage {
  readonly from: string;
  readonly until: string;
  readonly complete: boolean;
}

/** The outer span and completeness represented by every section source. */
export function reportSourceCoverage(
  sections: readonly ReportSection[],
  period: ReportPeriod,
): ReportSourceCoverage | null {
  const sources = sections
    .map((section) => section.source)
    .filter((source): source is ReportSectionSource => source !== null);

  if (sources.length === 0) {
    // oxlint-disable-next-line unicorn/no-null
    return null;
  }

  const [first, ...rest] = sources as [
    ReportSectionSource,
    ...ReportSectionSource[],
  ];

  let from = first.from;
  let until = first.until;

  for (const source of rest) {
    from = source.from < from ? source.from : from;
    until = source.until > until ? source.until : until;
  }

  return {
    from,
    until,
    complete: sources.every(
      (source) =>
        source.complete &&
        source.from === period.from &&
        source.until === period.until,
    ),
  };
}
