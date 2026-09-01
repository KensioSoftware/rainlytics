// The calendar report API exported from the package root.

export { type ReportSourceCoverage } from "./report-coverage.js";
export { defaultReportComparisonDefinitions } from "./report-comparison-definitions.js";
export {
  type AvailableReportMetricComparison,
  type AvailableReportSectionComparison,
  type ReportComparison,
  type ReportComparisonDefinition,
  type ReportComparisonDocumentSource,
  type ReportComparisonInput,
  type ReportComparisonSectionSource,
  type ReportComparisonSectionSources,
  type ReportMetricAssessment,
  type ReportMetricChange,
  type ReportMetricComparison,
  type ReportMetricDefinition,
  type ReportMetricMeasure,
  type ReportMetricPreference,
  type ReportMetricRowUnits,
  type ReportMetricTrend,
  type ReportSectionComparison,
  type UnavailableReportMetricComparison,
  type UnavailableReportMetricReason,
  type UnavailableReportSectionComparison,
  type UnavailableReportSectionComparisonReason,
  reportComparisonSchemaVersion,
} from "./report-comparison-types.js";
export {
  previousReportPeriod,
  reportComparison,
} from "./report-comparisons.js";
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
