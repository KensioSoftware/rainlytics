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
query then pays data transfer.

The Glue database and table are deleted with the stack. The raw objects stay in the retained log
bucket and a later deployment can recreate the catalog definitions.

<!-- card
```typescript
const table = new LogTable(this, "Table", {
  deliveries: [delivery],
});
```
-->
