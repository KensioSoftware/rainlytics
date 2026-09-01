// Deriving changes between adjacent stored calendar report documents.

import { reportComparisonDefinitions } from "./report-comparison-definitions.js";
import { comparedSections } from "./report-comparison-pairs.js";
import {
  type ReportComparison,
  type ReportComparisonDocumentSource,
  type ReportComparisonInput,
  reportComparisonSchemaVersion,
} from "./report-comparison-types.js";
import { sameReportValue } from "./report-comparison-json.js";
import type { ReportDocument } from "./report-document.js";
import { reportPeriodDifference } from "./report-period-differences.js";
import { previousReportPeriod, type ReportPeriod } from "./report-periods.js";

/** Compares two adjacent stored reports without querying raw data. */
export function reportComparison(
  input: ReportComparisonInput,
): ReportComparison {
  assertPreviousPeriod(input.current.period, input.previous.period);
  const definitions = reportComparisonDefinitions(input.definitions ?? []);

  return {
    kind: "calendar-report-comparison",
    schemaVersion: reportComparisonSchemaVersion,
    reports: {
      current: documentSource(input.current),
      previous: documentSource(input.previous),
    },
    sections: comparedSections(input.current, input.previous, definitions),
  };
}

export { previousReportPeriod } from "./report-periods.js";

/** Document metadata retained beside the derived values. */
function documentSource(
  document: ReportDocument,
): ReportComparisonDocumentSource {
  return {
    schemaVersion: document.schemaVersion,
    period: document.period,
    sourceCoverage: document.sourceCoverage,
    computedAt: document.computedAt,
  };
}

/** Refuses two reports that are not adjacent in the same calendar. */
function assertPreviousPeriod(
  current: ReportPeriod,
  previous: ReportPeriod,
): void {
  const expected = previousReportPeriod(current);

  if (!sameReportValue(expected, previous)) {
    throw new RangeError(
      `The previous ${current.unit} report has mismatched calendar fields.` +
        ` ${reportPeriodDifference(expected, previous)}.`,
    );
  }
}
