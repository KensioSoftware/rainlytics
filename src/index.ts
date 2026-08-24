// Rainlytics normalises what CloudFront, the load balancer, the application
// and the beacon each report into one event stream, and keeps it on S3 under
// Hive-style partitions.
//
// This module is the part both halves of the package share. Nothing reachable
// from here may reach for a Node built-in or for `aws-cdk-lib`, because
// browser code imports it too. `scripts/sh/pack-check.sh` enforces that on
// the built output.

export {
  availableLogFields,
  type DeliveredLogField,
  deliveredLogFieldNames,
  deliveredLogFields,
  omittedLogFields,
} from "./log-fields.js";
export {
  defaultPartitionGranularity,
  type PartitionGranularity,
} from "./partition-keys.js";
export {
  deliverySuffixPath,
  type PartitionAddress,
  partitionPrefix,
  timePartitionKeyNames,
} from "./partitions.js";
