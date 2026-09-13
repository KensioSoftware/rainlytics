# Log table

`LogTable` creates a Glue database and table that let Athena query your CloudFront logs in S3.
The table describes the files written by one or more log deliveries.

```typescript
import { LogTable } from "@kensio/rainlytics/cdk";

const table = new LogTable(this, "Table", {
  deliveries: [delivery],
});
```

The defaults create `rainlytics.cloudfront_logs`.

## The delivery defines the table

Pass the delivery constructs to `deliveries`. The table uses their bucket, prefix, fields, format
and partition granularity.

Several distributions can share one table:

```typescript
const table = new LogTable(this, "Table", {
  deliveries: [siteDelivery, docsDelivery],
});
```

All deliveries must use the same bucket, prefix, output format, granularity and field set. The
`distributionid` partition separates their objects.

## Describe a delivery in another stack

If the delivery is defined in another stack or outside CDK, pass an object describing its
configuration. It must include all six properties shown here:

```typescript
import { deliveredLogFieldNames } from "@kensio/rainlytics";
import { LogTable } from "@kensio/rainlytics/cdk";

const table = new LogTable(this, "Table", {
  deliveries: [
    {
      distributionId: "E1EXAMPLE1234",
      logBucket: logs.bucket,
      prefix,
      outputFormat: "json",
      granularity: "hourly",
      fields: deliveredLogFieldNames,
    },
  ],
});
```

Use the delivery construct directly when it is available. Rainlytics validates both forms in the
same way. Deliveries must agree on their shared settings, and each bucket's name and ARN must
refer to the same bucket.

A description must also match the deployed CloudFront configuration. Rainlytics cannot check that
during synthesis. A wrong prefix can produce a valid table that returns no rows because it points
at an empty S3 path.

## Split the delivery from the query layer

To keep analytics in another region, use two stacks. Put `CloudFrontLogDelivery` in `us-east-1`,
where AWS configures CloudFront logging. Put the bucket, table, workgroup and summaries in your
chosen region.

Define the bucket name and prefix as shared constants:

```typescript
const logBucketName = "example-rainlytics-logs";
const prefix = "rainlytics";
```

The first stack creates the storage and query resources:

```typescript
const storing = new Stack(app, "DataStack", {
  env: { account, region: "eu-west-1" },
});
const logs = new LogBucket(storing, "Logs", { bucketName: logBucketName });

new LogTable(storing, "Table", {
  deliveries: [
    {
      distributionId: "E1EXAMPLE1234",
      logBucket: logs.bucket,
      prefix,
      outputFormat: "json",
      granularity: "hourly",
      fields: deliveredLogFieldNames,
    },
  ],
});
```

The second stack configures delivery to that bucket from `us-east-1`:

```typescript
const delivering = new Stack(app, "DeliveryStack", {
  env: { account, region: "us-east-1" },
});

new CloudFrontLogDelivery(delivering, "Delivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: Bucket.fromBucketName(delivering, "Logs", logBucketName),
  prefix,
});
```

Use the shared bucket name in both stacks. Reading `logs.bucket.bucketName` from the other region
would create a CDK cross-region reference, which needs additional resources to resolve. The
delivery description also uses the shared name and prefix to match the deployed configuration.

`LogBucket` grants access to delivery sources in `us-east-1`, including when the bucket itself is
in another region.

## Partition projection

Partition projection lets Athena calculate S3 paths from the query's partition values. The table
defines the path pattern and allowed values. New log partitions need no catalog registration or
Glue crawler.

For hourly delivery, the partition keys are:

```text
distributionid, year, month, day, hour
```

A query should name the time partitions it needs:

```sql
SELECT cs_uri_stem, count(*) AS views
FROM rainlytics.cloudfront_logs
WHERE distributionid = 'E1EXAMPLE1234'
  AND year = '2026'
  AND month = '09'
  AND day = '01'
  AND hour = '14'
GROUP BY 1
ORDER BY 2 DESC
```

Partition values are zero-padded strings, such as `hour = '04'`. These conditions limit the S3
paths Athena scans. Add `timestamp_ms` bounds when the requested range starts or ends inside a
partition.

## Column names and values

Every delivered value is a string in both JSON and Parquet. Cast values inside SQL:

```sql
SELECT
  from_unixtime(cast(timestamp_ms AS bigint) / 1000) AS requested_at,
  cast(sc_status AS integer) AS status,
  nullif(cs_referer, '-') AS referrer,
  url_decode(cs_uri_stem) AS path
FROM rainlytics.cloudfront_logs
WHERE year = '2026' AND month = '09' AND day = '01'
```

CloudFront writes `-` for an empty field and percent-encodes logged values. Rainlytics normalizes
CloudFront field names to lowercase Glue columns:

| CloudFront field | Glue column     |
| ---------------- | --------------- |
| `timestamp(ms)`  | `timestamp_ms`  |
| `cs(Referer)`    | `cs_referer`    |
| `cs(User-Agent)` | `cs_user_agent` |
| `x-host-header`  | `x_host_header` |
| `c-ip`           | `c_ip`          |

The JSON SerDe carries explicit mappings. Parquet uses the normalized names written by CloudFront.

## Set the first projected year

Projection starts at 2026 by default and ends at the current year. Raise `firstYear` for a later
deployment:

```typescript
const table = new LogTable(this, "Table", {
  deliveries: [delivery],
  firstYear: 2028,
});
```

Years before the first log object increase planning work when a query omits the year. A fixed value
also keeps old partitions visible after the calendar year changes.

## Rename the dataset

```typescript
const table = new LogTable(this, "Table", {
  deliveries: [delivery],
  databaseName: "site_analytics",
  tableName: "requests",
});
```

Names use lowercase letters, digits and underscores and must start with a letter. Pass the same
names to command-line queries with `--database` when you change the defaults.

## Region and removal

Keep the table and workgroup in the log bucket's region to avoid cross-region S3 transfer charges.
The separate delivery stack must remain in `us-east-1`.

The Glue database and table are deleted with the stack. The raw objects stay in the retained log
bucket and a later deployment can recreate the catalog definitions.

<!-- card
```typescript
const table = new LogTable(this, "Table", {
  deliveries: [delivery],
});
```
-->
