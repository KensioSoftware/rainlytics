# Query workgroup

`QueryWorkgroup` creates the Athena workgroup used by Rainlytics and a bucket for Athena results.

```typescript
import { QueryWorkgroup } from "@kensio/rainlytics/cdk";

const workgroup = new QueryWorkgroup(this, "Workgroup");
```

The default workgroup is named `rainlytics`. Each query can scan at most 10 GiB, and result objects
expire after 7 days.

## Limit query cost

Athena charges by bytes scanned. A query without partition predicates can read the full log bucket
and still succeed. The workgroup stops a query when its scan passes the configured limit.

At the standard Athena rate of $5 per TB, the 10 GiB default caps one query near five cents. Change
the limit for your dataset:

```typescript
import { Size } from "aws-cdk-lib";

const workgroup = new QueryWorkgroup(this, "Workgroup", {
  bytesScannedCutoff: Size.gibibytes(50),
});
```

Use a limit above the largest legitimate report. A lower limit is more useful on a small site
because it can catch an accidental full scan.

Athena has a minimum billed scan. Rainlytics rejects a cutoff below that minimum during synthesis.

## Result storage

The workgroup enforces its result configuration. Queries write below `queries/` in a private,
TLS-only bucket with S3-managed encryption.

```typescript
import { Duration } from "aws-cdk-lib";

const workgroup = new QueryWorkgroup(this, "Workgroup", {
  resultsRetention: Duration.days(30),
  resultsPrefix: "athena-results",
});
```

Query results are derived data, so the bucket is unversioned. CloudWatch query metrics are disabled
because those custom metrics have a monthly charge even when no query runs. The CLI reads scan and
duration data from Athena after each query.

## Grant query access

The identity running `rainlytics query`, `saved-query` or a named command with `--query` needs
Athena, Glue and S3 permissions. Grant the complete set from CDK:

```typescript
workgroup.grantQuerying(role, table);
```

The grant covers:

- starting, stopping and reading queries in this workgroup
- reading saved queries
- reading the Glue database, table and partitions
- reading raw objects from the log bucket
- reading and writing the workgroup's results bucket
- decrypting either bucket when it uses a customer-managed key

The scheduled summary functions receive the same scoped permissions from `RollupSummaries`.

A role that only reads stored summaries needs `s3:GetObject` on the summaries bucket. Athena access
is unnecessary for that path.

## Name additional deployments

Workgroup names are unique in an account and region. Give a second deployment its own name:

```typescript
const workgroup = new QueryWorkgroup(this, "DocsWorkgroup", {
  workgroupName: "rainlytics-docs",
});
```

Pass the same name to the CLI with `--workgroup` or configure it in your shell command. Queries that
omit a workgroup run in Athena's `primary` workgroup and bypass this scan limit.

## Removal

The workgroup is deleted with the stack, including its saved queries. The results bucket is retained
by default and empties through its lifecycle rule.

To delete the bucket with the stack:

```typescript
import { RemovalPolicy } from "aws-cdk-lib";

const workgroup = new QueryWorkgroup(this, "Workgroup", {
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});
```

Both options are required for a non-empty bucket.

<!-- card
```typescript
const workgroup = new QueryWorkgroup(this, "Workgroup");
```
-->
