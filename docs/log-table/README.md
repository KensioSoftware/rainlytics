# Log table

The Glue database and table Athena reads the delivered logs through. The partitions are projected,
and no crawler runs over the bucket.

```typescript
import {
  CloudFrontLogDelivery,
  LogBucket,
  LogTable,
} from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "RainlyticsLogs");

const delivery = new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});

new LogTable(this, "RainlyticsTable", { deliveries: [delivery] });
```

That is a database called `rainlytics` holding a table called `cloudfront_logs`, over
`s3://<your-bucket>/rainlytics/`. Querying it also takes an Athena workgroup, filed as
[#21](https://github.com/KensioSoftware/rainlytics/issues/21).

## The table is built from the delivery

`deliveries` is the only required prop, and everything else follows from it. The columns are the
fields the delivery asks CloudFront for, the location is the bucket and prefix it writes into, the
partition keys are the ones its `suffixPath` produces, and the SerDe is whatever reads its output
format.

Passing a bucket and a format here as well would give each of those two definitions. They would
agree on the day they were written and stop agreeing later, and the failure when they stop is the
quiet one. A table with CloudFront's spelling over Parquet data succeeds, scans every byte it was
asked for, and returns null in every column of every row. A partition scan that costs money and
answers nothing looks exactly like a site nobody visited.

## Projection, and what it saves

`projection.enabled` is on and no partition is ever registered. Athena works out which prefixes a
query reads by expanding each partition column's declared values and narrowing them by the `WHERE`
clause. Athena reaches a partition by arithmetic, and no crawler runs on a schedule to find one
(a Glue crawler bills per second of run time, and Rainlytics avoids that shape of cost).

The saving is on every query. This one reads one hour:

```sql
SELECT cs_uri_stem, count(*) AS views
FROM "rainlytics"."cloudfront_logs"
WHERE distributionid = 'E1EXAMPLE1234'
  AND year = '2026' AND month = '08' AND day = '27' AND hour = '14'
GROUP BY cs_uri_stem
ORDER BY views DESC
LIMIT 10
```

Take the four time predicates off and the same query reads every hour the bucket holds. Athena
bills per terabyte scanned. The predicate is most of what a query costs.

## Predicates prune only on the partition keys

The partition keys are `distributionid`, `year`, `month`, `day` and `hour`. A predicate on anything
else narrows the rows after they have been read, and the bytes are billed either way.

That includes the record's own timestamp. `WHERE from_unixtime(cast(timestamp_ms AS bigint) / 1000)

> current_timestamp - interval '1' day` answers correctly and scans the whole dataset to do it.
> Name the day and the hour as well, and let the timestamp trim the edges.

Each key is a string, and every value is zero padded to a fixed width. Athena compares a projected
value against the S3 key one character at a time, so `hour = '4'` finds no partition under
`hour=04`, and `hour = 4` compares a string to a number. Both come back empty. An empty answer at
least fails where a wrong one would not.

## Every column is a string

CloudFront quotes every value in a JSON record, `timestamp(ms)` and `sc-status` included, and its
Parquet writer goes through Avro and types all eleven fields as a nullable string. Both were read
back off S3 in [#9](https://github.com/KensioSoftware/rainlytics/issues/9). A table declaring
`timestamp_ms bigint` over that data fails with `HIVE_BAD_DATA`.

So the casting belongs in the query:

```sql
SELECT
  from_unixtime(cast(timestamp_ms AS bigint) / 1000) AS at,
  cast(sc_status AS integer) AS status
FROM "rainlytics"."cloudfront_logs"
WHERE year = '2026' AND month = '08' AND day = '27'
```

Values are URL encoded as CloudFront wrote them, and an empty field arrives as `-`.
`url_decode` and a `nullif(cs_referer, '-')` are worth having in any query a person reads.

## One set of column names, whichever format is underneath

AWS renames every field on the way into a Parquet file. Each run of characters outside `[A-Za-z0-9]`
becomes one underscore and a trailing underscore is dropped, so `cs(Referer)` is written
`cs_Referer`. JSON keeps CloudFront's own spelling.

Athena lowercases every column name it stores, and the table uses that lowercased Parquet name for
both formats:

| Delivered as         | In a JSON record     | In a Parquet file    | Glue column          |
| -------------------- | -------------------- | -------------------- | -------------------- |
| `timestamp(ms)`      | `timestamp(ms)`      | `timestamp_ms`       | `timestamp_ms`       |
| `cs(Referer)`        | `cs(Referer)`        | `cs_Referer`         | `cs_referer`         |
| `cs(User-Agent)`     | `cs(User-Agent)`     | `cs_User_Agent`      | `cs_user_agent`      |
| `x-host-header`      | `x-host-header`      | `x_host_header`      | `x_host_header`      |
| `x-edge-result-type` | `x-edge-result-type` | `x_edge_result_type` | `x_edge_result_type` |

The other six follow the same rule. A rollup query is then written once and keeps working if the
delivery is ever recreated in the other format.

The two formats reach that column differently. Athena's Parquet reader tries an exact name match and
falls back to a case-insensitive one. That fallback reaches `cs_Referer` from a `cs_referer`
column.
A JSON table carries `mapping.cs_referer` in its SerDe parameters instead, pointing the column at
`cs(Referer)` in the record.

That mapping is why the JSON arm uses the OpenX SerDe. AWS recommends the Hive JSON SerDe over it,
on the grounds that OpenX can return values non-deterministically, and the Hive one has no `mapping`
property at all. Parquet sidesteps the choice, and that is a point in its favour on the read
side.

`plain`, `w3c` and `raw` deliveries are refused at synthesis. They are delimited text with a header,
and none of that has been tested here.

## Several distributions, one table

`distributionid` partitions before time does, so one table covers every site delivering into the
bucket:

```typescript
new LogTable(this, "RainlyticsTable", {
  deliveries: [siteDelivery, blogDelivery],
});
```

The projection enumerates the distribution ids. A query naming one reads that site's objects
alone, and a query naming none reads all of them. The deliveries have to agree about the bucket, the
prefix, the output format, the partition granularity and the field set. One table describes one
dataset, and a pair that disagree is refused at synthesis with the difference named.

## The first year

The year is projected as a date range running from a fixed start to `NOW`. The default is
`2026,NOW`, and 2026 is when the first Rainlytics delivery wrote its first object.

```typescript
new LogTable(this, "RainlyticsTable", {
  deliveries: [delivery],
  firstYear: 2029,
});
```

Raise it on a site set up later. Every year in the range is expanded on a query that names no year,
and the years before the data cost planning time and find no objects.

It is deliberately a constant rather than the current year. A template that read the clock would
change on 1 January, and the range it wrote would start at the year of the most recent deploy.
Everything before that would fall outside the projection, and Athena would answer from what was
left without mentioning that it had stopped reading the rest.

## The names, and the command line

`rainlytics` and `cloudfront_logs` come from one exported definition, which the `rainlytics` command
reads when it writes SQL:

```typescript
import { defaultLogDataset, qualifiedTableName } from "@kensio/rainlytics";

qualifiedTableName(); // '"rainlytics"."cloudfront_logs"'
```

Change them with `databaseName` and `tableName`, and pass the same names to whatever queries the
table. Both are checked at synthesis against the names Athena reads back without escaping. Those
are lowercase letters, digits and underscores, starting with a letter. Glue takes a good deal more
than that, and Athena lowercases whatever it stores. A database called `Rainlytics Logs` deploys and
then answers to a name the caller has to work out.

## Keep it in the region the bucket is in

Athena reads a bucket in another region and bills the transfer for every query. The table itself is
free to sit anywhere, so put the stack holding it where the log bucket is. Log delivery is the only
part of Rainlytics that has to be configured from us-east-1.

## Permissions for a scoped deploy role

Skippable on an account whose CloudFormation execution role holds `AdministratorAccess`, which is
what `cdk bootstrap` gives it by default.

```typescript
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

new PolicyStatement({
  sid: "TheRainlyticsCatalog",
  actions: [
    "glue:CreateDatabase",
    "glue:GetDatabase",
    "glue:UpdateDatabase",
    "glue:DeleteDatabase",
    "glue:CreateTable",
    "glue:GetTable",
    "glue:UpdateTable",
    "glue:DeleteTable",
  ],
  resources: [
    `arn:aws:glue:${region}:${account}:catalog`,
    `arn:aws:glue:${region}:${account}:database/rainlytics`,
    `arn:aws:glue:${region}:${account}:table/rainlytics/*`,
  ],
});
```

Read that as inferred from the two resources the construct creates. Nobody has yet deployed this
table with a role narrower than `AdministratorAccess`, so the list has never been tested against the
failure a missing action would cause. The catalog ARN is in there because Glue authorises a database
call against the catalog holding it as well as against the database.

Querying needs a separate policy, held by whoever runs the query rather than by the deploy role.
That is `glue:GetTable`, `glue:GetPartitions` and the Athena and S3 actions, and it belongs with the
workgroup in [#21](https://github.com/KensioSoftware/rainlytics/issues/21).

## Removal

The database and the table are deleted when the stack is, and both hold definitions only. The
objects on S3 are the dataset, the log bucket is retained by default, and a table deleted by mistake
is one `cdk deploy` away from being back.

<!-- card
```typescript
new LogTable(this, "RainlyticsTable", {
  deliveries: [delivery],
});
```
-->
