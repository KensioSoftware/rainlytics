// The versioned JSON envelope for one closed calendar report period.

import {
  type ReportSourceCoverage,
  reportSourceCoverage,
} from "./report-coverage.js";
import type { ReportPeriod } from "./report-periods.js";
import type { ReportSection } from "./report-section-types.js";

/** The current report document and key shape. */
export const reportSchemaVersion = 1;

/** Several report sections over one closed calendar period. */
export interface ReportDocument {
  /** The schema version carried in this document's S3 key. */
  readonly schemaVersion: number;

  /** The calendar period every section is about. */
  readonly period: ReportPeriod;

  /** The stored source span represented by the sections. */
  readonly sourceCoverage: ReportSourceCoverage | null;

  /** When the report was assembled, in ISO 8601 and UTC. */
  readonly computedAt: string;

  /** The questions in the report, including unavailable optional ones. */
  readonly sections: readonly ReportSection[];
}

/** Input for a report document. */
export interface ReportDocumentInput {
  readonly period: ReportPeriod;
  readonly computedAt: Date;
  readonly sections: readonly ReportSection[];
}

/** Builds the versioned document and derives its source coverage. */
export function reportDocument(input: ReportDocumentInput): ReportDocument {
  if (Number.isNaN(input.computedAt.getTime())) {
    throw new RangeError(
      "Cannot build a report computation time from an invalid Date.",
    );
  }

  if (input.computedAt.getTime() < Date.parse(input.period.until)) {
    throw new RangeError(
      `A report for ${input.period.startsOn} cannot be computed before its` +
        ` period closes at ${input.period.until}.`,
    );
  }

  return {
    schemaVersion: reportSchemaVersion,
    period: input.period,
    sourceCoverage: reportSourceCoverage(input.sections, input.period),
    computedAt: input.computedAt.toISOString(),
    sections: input.sections,
  };
}
