// Rainlytics normalises what CloudFront, the load balancer, the application
// and the beacon each report into one event stream, and keeps it on S3 under
// Hive-style partitions.
//
// This module is the part both halves of the package share. Nothing reachable
// from here may reach for a Node built-in or for `aws-cdk-lib`, because
// browser code imports it too. `scripts/sh/pack-check.sh` enforces that on
// the built output.

export {
  cacheHitRatio,
  pageviews,
  referrers,
  rollups,
  searches,
  statusCodes,
} from "./rollup-questions.js";
export { beaconEventCap, beaconEvents } from "./beacon-rollup.js";
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
  aBeaconEvent,
  type BeaconEvent,
  beaconEventColumn,
  beaconPageColumn,
  beaconParameters,
  beaconQueryString,
  beaconSchemaVersion,
  beaconVersionColumn,
  defaultBeaconPath,
  outsideTheBeaconPath,
} from "./beacon-events.js";
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
