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
export {
  assertRollupName,
  botUserAgentPattern,
  currentMonth,
  matchedPath,
  type Rollup,
  type RollupRange,
  type RollupRequest,
  rollupRequest,
  rollupSql,
  rowsFor,
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
  type SummaryGranularity,
  summaryGranularities,
  type SummarySpan,
  summarySpan,
  type SummaryWindow,
} from "./summary-windows.js";
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
  type DeliveredLogField,
  deliveredLogColumnNames,
  deliveredLogFieldNames,
  deliveredLogFields,
  deliveredLogFieldsNamed,
  logColumnName,
  omittedLogFields,
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
