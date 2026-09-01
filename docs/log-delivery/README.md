# Log delivery

`CloudFrontLogDelivery` sends standard logging v2 records from a CloudFront distribution to a
`LogBucket`.

```typescript
import { CloudFrontLogDelivery, LogBucket } from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "Logs");

const delivery = new CloudFrontLogDelivery(this, "Delivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});
```

Pass `delivery` to `LogTable`.

## Deploy from `us-east-1`

AWS configures CloudFront standard logging v2 through the CloudWatch Logs API in `us-east-1`.
Rainlytics refuses to synthesize this construct in another region.

The distribution can be defined in another stack. The delivery only needs its ID:

```typescript
new CloudFrontLogDelivery(this, "Delivery", {
  distributionId: distribution.distributionId,
  logBucket: logs.bucket,
});
```

Using a string avoids a CDK cross-region reference when the distribution belongs to another stack.

A distribution can have one standard logging v2 delivery source. Remove an existing v2 source
before adding this construct. Legacy standard logging is separate and can continue at the same
time.

CloudFront may take up to 12 hours to apply a logging change.

## Output layout

The defaults use JSON, hourly partitions and the `rainlytics` prefix:

```text
s3://<bucket>/rainlytics/distributionid=E1EXAMPLE1234/year=2026/month=09/day=01/hour=14/
```

The partition path is Hive-compatible. `LogTable` projects these keys and needs no crawler.

Change the format or partition size when you create the delivery:

```typescript
const delivery = new CloudFrontLogDelivery(this, "Delivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
  outputFormat: "parquet",
  granularity: "daily",
  prefix: "analytics",
});
```

JSON is the default because CloudFront charges for conversion to Parquet and the project does not
assume that conversion saves money. Parquet reduces Athena bytes scanned on larger datasets. Choose
the format from measured traffic and query cost.

Changing the prefix or format later creates a second dataset shape. Existing objects stay at their
old keys and in their old format.

## Delivered fields

Rainlytics requests the smallest field set used by its built-in questions. The fields include the
request path, query string, referrer, user agent, host, country, response status, content type,
cache result, timestamp and viewer address.

The viewer address supports visitor counts and the repeated-event cap. To omit it:

```typescript
import { logFieldNamesWithoutAddress } from "@kensio/rainlytics";

const delivery = new CloudFrontLogDelivery(this, "Delivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
  fields: logFieldNamesWithoutAddress,
});
```

`LogTable` follows the selected field set. `RollupSummaries` then disables visitor counts and does
not read the visitor salt. The other default questions continue to work.

The first day after a field change contains a mixture of old and new records. Wait for a full day
of the new field set before comparing visitor totals.

## Customer-managed encryption

When the log bucket uses a customer-managed KMS key, the delivery service needs permission to use
that key. Rainlytics adds the grant when the key belongs to the same CDK construct graph. An
imported key may need its owning stack updated.

Test delivery after deployment. An encryption-policy error prevents new objects from reaching S3,
and the destination bucket cannot log the failed write.

## Deployment permissions

The standard CDK bootstrap role has enough permission. A restricted CloudFormation execution role
needs:

- CloudWatch Logs delivery source, destination and delivery management actions
- `cloudfront:AllowVendedLogDeliveryForResource` on the distribution
- the S3 permissions required by `LogBucket`
- IAM tagging and read/delete counterparts used by CloudFormation

Include `Get` and `Delete` actions as well as creation actions. CloudFormation reads resources
before updates and needs delete permission during rollback. A role with create-only permissions can
leave the stack in `ROLLBACK_FAILED`.

<!-- card
```typescript
const delivery = new CloudFrontLogDelivery(this, "Delivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});
```
-->
