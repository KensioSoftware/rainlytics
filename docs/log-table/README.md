# Log table

`LogTable` creates a Glue database and table over the objects written by one or more log deliveries.

```typescript
import { LogTable } from "@kensio/rainlytics/cdk";

const table = new LogTable(this, "Table", {
  deliveries: [delivery],
});
```

The defaults create `rainlytics.cloudfront_logs`.

## The delivery defines the table

The table reads its bucket, prefix, fields, format and partition granularity from `deliveries`.
One definition keeps the table aligned with the objects it describes.

Several distributions can share one table:

```typescript
const table = new LogTable(this, "Table", {
  deliveries: [siteDelivery, docsDelivery],
});
```

All deliveries must use the same bucket, prefix, output format, granularity and field set. The
`distributionid` partition separates their objects.

## Describe a delivery in another stack

`deliveries` takes anything carrying the six values a table is built from. A
`CloudFrontLogDelivery` publishes all six, and a plain object holding them does just as well:

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

Pass the construct where the stack holds one. A description is checked the way a construct is. Two
deliveries that disagree are refused, and so is a bucket whose name and ARN name different buckets.

What nothing here can check is whether the description matches how CloudFront was actually
configured. A prefix typed wrong builds a table over an empty path, and a query then comes back
with no rows rather than an error. That is the cost of the arrangement, and it is why a deployment
that can hold the construct should.

## Split the delivery from the query layer

Standard logging v2 is configured through the CloudWatch Logs API, and that API accepts the call in
us-east-1 however far away the bucket is. That is the only piece of Rainlytics pinned to a region.
The bucket, the table, the workgroup and the summaries go wherever a site's data belongs, and the
delivery alone has to be declared in us-east-1.

That makes two stacks, and both name the bucket and the prefix as literals:

```typescript
const logBucketName = "example-rainlytics-logs";
const prefix = "rainlytics";
```

The first stack holds the data:

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

The second configures the delivery into it, from us-east-1:

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

The literals are what makes this work. `logs.bucket.bucketName` is a token belonging to the
eu-west-1 stack, and reading it from the us-east-1 one is a cross-region reference, which CDK serves
with custom resources and an SSM parameter. A name both stacks already know needs none of that. The
same holds for the table, which describes the delivery rather than holding it.

Those two literals are also what a description gets wrong, so keep each in one constant and use it
on both sides.

`LogBucket` grants the delivery service access scoped to delivery sources in us-east-1 whatever
region the bucket itself is in, so a bucket in eu-west-1 works as it stands.

## Partition projection

The table projects partitions from the S3 path. Projection removes the need to register partitions
or run a Glue crawler.

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

Partition values are zero-padded strings. Use `hour = '04'`, not `hour = 4`. A condition on
`timestamp_ms` makes the result precise while leaving the partition scan unchanged. Use both
partition predicates and timestamp bounds when a range starts or ends inside a partition.

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

Keep the table in the log bucket's region. Athena can read an S3 bucket in another region, but each
query then pays data transfer. The delivery is the one piece that has to be in us-east-1, and
splitting it off is above.

The Glue database and table are deleted with the stack. The raw objects stay in the retained log
bucket and a later deployment can recreate the catalog definitions.

<!-- card
```typescript
const table = new LogTable(this, "Table", {
  deliveries: [delivery],
});
```
-->
