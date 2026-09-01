// Rainlytics normalises what CloudFront, the load balancer, the application
// and the beacon each report into one event stream, and keeps it on S3 under
// Hive-style partitions.
//
// This module is the part both halves of the package share. Nothing reachable
// from here may reach for a Node built-in or for `aws-cdk-lib`, because
// browser code imports it too. `scripts/sh/pack-check.sh` enforces that on
// the built output.

export {
  browsers,
  cacheHitRatio,
  pageviews,
  referrers,
  rollups,
  searches,
  statusCodes,
} from "./rollup-questions.js";
export { beaconEventCap, beaconEvents } from "./beacon-rollup.js";
export { errorEventNames, errorMessageLimit } from "./error-events.js";
export { javascriptErrors } from "./javascript-errors-rollup.js";
export { webVitals, webVitalsPercentile } from "./web-vitals-rollup.js";
export { vitalEventNames } from "./vital-events.js";
export {
  assertRollupName,
  botUserAgentPattern,
  currentMonth,
  matchedPath,
  partitionPredicate,
  type Rollup,
  type RollupRange,
  type RollupRequest,
  rollupRequest,
  rollupSql,
  type RollupTotals,
  rowsFor,
  summarisedWindow,
  windowPlaceholder,
  withoutVisitorCount,
} from "./rollups.js";
export {
  neverComputed,
  type RollupSummary,
  type SummaryCell,
  summaryKey,
  type SummaryLookup,
  type SummaryQuestion,
  type SummaryRow,
  summarySchemaVersion,
  type VisitorCount,
} from "./rollup-summaries.js";
export {
  defaultReportWeekStartsOn,
  type ReportPeriod,
  type ReportPeriodRequest,
  type ReportPeriodUnit,
  type ReportPeriodWithoutWeek,
  reportPeriod,
  reportPeriodUnits,
  type ReportWeekday,
  type ReportWeekPeriod,
} from "./report-periods.js";
export {
  type AvailableReportMetricComparison,
  type ApproximateReportSection,
  type AvailableReportSectionComparison,
  type AvailableReportSectionInput,
  defaultReportComparisonDefinitions,
  type ExactReportSection,
  type MissingReportSectionInput,
  type ReportCalculation,
  type ReportComparison,
  type ReportComparisonDefinition,
  type ReportComparisonDocumentSource,
  type ReportComparisonInput,
  type ReportComparisonSectionSource,
  type ReportComparisonSectionSources,
  type ReportCompositionRule,
  type ReportDocument,
  type ReportDocumentInput,
  type ReportMetricAssessment,
  type ReportMetricChange,
  type ReportMetricComparison,
  type ReportMetricDefinition,
  type ReportMetricMeasure,
  type ReportMetricPreference,
  type ReportMetricRowUnits,
  type ReportMetricTrend,
  reportDocument,
  reportKey,
  type ReportSectionComparison,
  type ReportRowsValue,
  reportComparison,
  reportComparisonSchemaVersion,
  reportSchemaVersion,
  type ReportSection,
  type ReportSectionInput,
  reportSection,
  type ReportSectionSource,
  type ReportSectionValue,
  type ReportSourceCoverage,
  type ReportVisitorValue,
  previousReportPeriod,
  type UnavailableReportMetricComparison,
  type UnavailableReportMetricReason,
  type UnavailableReportReason,
  type UnavailableReportSection,
  type UnavailableReportSectionComparison,
  type UnavailableReportSectionComparisonReason,
} from "./reports.js";
export { hoursIn, summaryCoverage } from "./summary-coverage.js";
export { totalledRows } from "./summary-totals.js";
export {
  visitorColumn,
  visitorCountSql,
  visitorRows,
} from "./visitor-counts.js";
export {
  defaultVisitorSaltParameter,
  saltedSql,
  visitorIdentifier,
  visitorSaltDay,
  visitorSaltMessage,
  reportVisitorSaltMessage,
  visitorSaltPlaceholder,
  visitorText,
} from "./visitor-identity.js";
export {
  type SummaryGranularity,
  summaryGranularities,
  type SummarySpan,
  summarySpan,
  type SummaryWindow,
} from "./summary-windows.js";
export {
  defaultRecomputedWindows,
  recomputedWindows,
  windowedSql,
  windowRange,
} from "./summary-runs.js";
export {
  type BeaconEvent,
  beaconParameters,
  beaconQueryString,
  beaconSchemaVersion,
  defaultBeaconPath,
} from "./beacon-events.js";
export {
  aBeaconEvent,
  beaconEventColumn,
  beaconMessageColumn,
  beaconPageColumn,
  beaconValueColumn,
  beaconVersionColumn,
  outsideTheBeaconPath,
} from "./beacon-rows.js";
export { decodedColumn, decodedParameter } from "./log-encoding.js";
export {
  lastRange,
  type PartitionValues,
  partitionValuesCovering,
  type TimeRange,
} from "./time-range.js";
export {
  bytesBilledFor,
  bytesBilledMinimum,
  dollarsPerTerabyteScanned,
  queryChargeInDollars,
} from "./athena-pricing.js";
export {
  assertQueryableName,
  defaultLogDataset,
  defaultWorkgroupName,
  type LogDataset,
  qualifiedTableName,
  savedQueryPrefix,
} from "./dataset.js";
export {
  availableLogFields,
  countsVisitorsFrom,
  type DeliveredLogField,
  deliveredLogColumnNames,
  deliveredLogFieldNames,
  deliveredLogFields,
  deliveredLogFieldsNamed,
  logColumnName,
  logFieldNamesWithoutAddress,
  omittedLogFields,
  visitorAddressField,
  visitorCountFields,
} from "./log-fields.js";
export {
  defaultFirstPartitionYear,
  defaultPartitionGranularity,
  type PartitionGranularity,
  type PartitionProjectionScope,
} from "./partition-keys.js";
export {
  deliverySuffixPath,
  type PartitionAddress,
  partitionKeyNames,
  partitionLocationTemplate,
  partitionPrefix,
  partitionProjection,
  timePartitionKeyNames,
} from "./partitions.js";
