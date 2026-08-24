# Log delivery

Sends a CloudFront distribution's access logs into a Rainlytics log bucket, partitioned and with the
field set the rollups read. This is the piece that turns a bucket into a pipeline.

```typescript
import { CloudFrontLogDelivery, LogBucket } from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "RainlyticsLogs");

new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});
```

## It has to live in us-east-1

Standard logging v2 is configured through the CloudWatch Logs API, and that API only accepts these
calls in us-east-1 whatever region the bucket is in. The construct refuses to synthesise anywhere
else, naming the stack.

Most sites keep their distribution somewhere else. That usually means a second stack:

```typescript
const delivery = new Stack(app, "RainlyticsDeliveryStack", {
  env: { account, region: "us-east-1" },
});
```

That is also why `distributionId` is a string rather than an `IDistribution`. Passing a construct
across regions needs CDK's cross-region references and the custom resources they bring with them. A
literal id needs neither. Pass `distribution.distributionId` if the two stacks are arranged so it
resolves.

## One delivery source per distribution

A distribution can carry a single delivery source. A second fails with `This ResourceId has already
been used in another Delivery Source in this account`. A distribution already running standard
logging v2 has to give that up before Rainlytics can take it over. Standard logging (legacy) is
separate and can keep running alongside.

## Logging changes take up to twelve hours

A successful deploy is not the same as logs arriving. CloudFront applies a logging change within
twelve hours. An empty bucket the morning after a deploy is the normal case at that point.

## Format, fields and partitions

Output is JSON. Parquet is the better shape for a dataset Athena reads, and it carries a CloudWatch
conversion charge that AWS documents only by name. It stays an opt-in until there are numbers to
justify it.

```typescript
new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
  outputFormat: "parquet",
  granularity: "daily",
});
```

The output format can only be set when the delivery destination is created. Changing it later
replaces the destination rather than updating it.

Fields default to the Rainlytics set, which is the minimum the rollups need. Partitions are hourly
by default, Hive-compatible, and land under a `rainlytics` prefix inside the bucket. Changing the
prefix later splits the dataset, because what was already written stays where it was written.

## Encrypted buckets

A bucket encrypted with a customer-managed key needs the delivery service allowed to use it. Without
that, the write is refused and the refusal appears in no log the bucket keeps. The construct adds
that grant, scoped to your account and its delivery sources, whenever the key is one CDK can reach.

An imported key is the exception. CDK cannot add a statement to a key policy belonging to another
template. The grant would be written and never applied. The construct emits a build warning instead,
and the statement to add by hand is on the [log bucket](../log-bucket/) page.

<!-- card
```typescript
new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});
```
-->
