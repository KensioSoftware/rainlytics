// CDK constructs for the Rainlytics pipeline, reached as
// `@kensio/rainlytics/cdk`.
//
// Kept behind a subpath of its own so that a browser bundle importing the
// beacon cannot reach `aws-cdk-lib` through the package root. `aws-cdk-lib`
// and `constructs` are optional peer dependencies, so installing Rainlytics
// for the beacon alone pulls neither of them in.

export {
  CloudFrontLogDelivery,
  type CloudFrontLogDeliveryProps,
  type LogDeliveryBucket,
  type LogOutputFormat,
  logDeliveryRegion,
} from "./log-delivery.js";
export {
  defaultLogRetention,
  LogBucket,
  type LogBucketProps,
} from "./log-bucket.js";
export { requireStackRegion } from "./stack-region.js";
