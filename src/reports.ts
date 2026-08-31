// The calendar report API exported from the package root.

export { type ReportSourceCoverage } from "./report-coverage.js";
export {
  type ReportDocument,
  type ReportDocumentInput,
  reportDocument,
  reportSchemaVersion,
} from "./report-document.js";
export { reportKey } from "./report-key.js";
export {
  type ApproximateReportSection,
  type AvailableReportSectionInput,
  type ExactReportSection,
  type MissingReportSectionInput,
  type ReportCalculation,
  type ReportCompositionRule,
  type ReportRowsValue,
  type ReportSection,
  type ReportSectionInput,
  type ReportSectionSource,
  type ReportSectionValue,
  type ReportVisitorValue,
  type UnavailableReportReason,
  type UnavailableReportSection,
} from "./report-section-types.js";
export { reportSection } from "./report-sections.js";
