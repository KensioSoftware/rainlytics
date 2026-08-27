// CDK constructs for the Rainlytics pipeline, reached as
// `@kensio/rainlytics/cdk`.
//
// Kept behind a subpath of its own so that a browser bundle importing the
// beacon cannot reach `aws-cdk-lib` through the package root. `aws-cdk-lib`
// and `constructs` are optional peer dependencies, so installing Rainlytics
// for the beacon alone pulls neither of them in.

export { logDeliveryRegion } from "./delivery-region.js";
export type { LogDeliveryBucket } from "./delivery-bucket.js";
export {
  CloudFrontLogDelivery,
  type CloudFrontLogDeliveryProps,
  type LogOutputFormat,
} from "./log-delivery.js";
export { LogBucket, type LogBucketProps } from "./log-bucket.js";
export { LogTable, type LogTableProps } from "./log-table.js";
export {
  assertUsableCutoff,
  defaultBytesScannedCutoff,
  defaultResultsRetention,
  dollarsPerTerabyteScanned,
  smallestBytesScannedCutoff,
} from "./query-cost.js";
export { QueryWorkgroup, type QueryWorkgroupProps } from "./query-workgroup.js";
export { type LogTableFormat, logTableFormat } from "./log-table-format.js";
export { defaultLogRetention, defaultRecoveryWindow } from "./log-lifecycle.js";
export { requireStackRegion } from "./stack-region.js";
