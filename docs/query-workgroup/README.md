# Query workgroup

The Athena workgroup Rainlytics queries run in. It bounds what one query may scan and holds the
bucket results are written to.

```typescript
import { QueryWorkgroup } from "@kensio/rainlytics/cdk";

const queries = new QueryWorkgroup(this, "RainlyticsQueries");
```

That is a workgroup called `rainlytics` with a ten gibibyte cutoff per query, and a results bucket
whose objects expire after a week. A query has to name the workgroup to run in it.

## What the cutoff is for

Athena charges $5.00 per terabyte scanned, with a minimum of ten million bytes billed for every
query whatever it reads (both figures read from the AWS Pricing API for us-east-1 on 2026-08-27).
Nothing about the charge is visible at the time. A query that names no partition reads the whole
dataset, succeeds, and shows up as a line on next month's bill without saying which query it was.

`BytesScannedCutoffPerQuery` turns that into a failure at the moment the query runs:

```
Bytes scanned limit was exceeded. The query scanned 10000001 bytes, and
workgroup rainlytics allows 10000000 per query.
```

## Where ten gibibytes comes from

The default is sized from the widest query the pipeline has a reason to run, not from what a mistake
costs.

[#9](https://github.com/KensioSoftware/rainlytics/issues/9) measured a site serving 156,000 requests
a day at 4.42MB of gzipped logs a day, so its raw store levels off near 1.6GB under the 365-day
expiry. A rollup reading that whole year scans well under a fifth of the cutoff. What is left is
headroom for six years of that site, or for one year of a site six times busier.

At $5 per terabyte, ten gibibytes caps a single query at about five cents.

Read it as a ceiling on one mistake rather than as a correctness check. A full scan of a small
dataset stays under it and costs a fraction of a cent. That is the right answer for a person asking
an ad-hoc question.

```typescript
import { Size } from "aws-cdk-lib/core";

new QueryWorkgroup(this, "RainlyticsQueries", {
  bytesScannedCutoff: Size.gibibytes(100),
});
```

Raise it on a busy site whose legitimate rollups approach the limit. Lower it on a quiet one.
Where the whole dataset is a few hundred megabytes, a cutoff near that size catches an unpartitioned
query as well as an expensive one. That is a stronger guarantee than the default gives.

Athena refuses a cutoff below ten million bytes, since that is what every query bills anyway. The
construct refuses one at synthesis, before the deploy gets that far.

## The configuration is enforced

`EnforceWorkGroupConfiguration` is on. The workgroup's `ResultConfiguration` then wins over
anything a caller asks for, and a client passing its own output location or encryption option writes
to the results bucket under S3-managed keys regardless.

The cutoff stands apart from this. `BytesScannedCutoffPerQuery` is a workgroup property and
`StartQueryExecution` has no parameter for it. No client can raise it either way. What
enforcement adds is that results cannot be sent somewhere outside the expiry, the encryption and the
blocked public access on the bucket below, and that every query's output stays somewhere the account
owner has already reasoned about.

## Queries run in `primary` unless they say otherwise

Athena gives every account a `primary` workgroup with no cutoff at all, and that is where a query
naming no workgroup lands. So the guardrail depends on the workgroup name reaching whatever runs the
query:

```typescript
import { defaultWorkgroupName } from "@kensio/rainlytics";
```

The construct and the `rainlytics` command read that same export, which is what keeps the two from
drifting. Pass `workgroupName` to change it, and pass the same name to whatever queries.

## The results bucket

Athena writes one result object per query under `queries/` in a bucket of its own, with a metadata file beside it. A `SELECT` answers with a CSV and the other statement types vary.
Public access is blocked, TLS is required, and objects are encrypted with S3-managed keys. The
workgroup asks for `SSE_S3` as well. The encryption is then a property of the query and not only
of the bucket it happens to write to.

Objects expire after seven days:

```typescript
import { Duration } from "aws-cdk-lib/core";

new QueryWorkgroup(this, "RainlyticsQueries", {
  resultsRetention: Duration.days(90),
});
```

A week covers a person going back to something they ran earlier in the week. Nothing in the pipeline
needs longer. The command line reads a result once as the query finishes, and M3's rollups write
their summaries elsewhere. Left to accumulate, this is a bucket nobody looks at that grows by one
object per query for ever.

The bucket is unversioned, unlike the [log bucket](../log-bucket/). A result is derived data, and
the query that produced it can produce it again. There is nothing here worth being able to
undelete.

## No CloudWatch metrics

`PublishCloudWatchMetricsEnabled` is off, and that is a cost decision.

CloudWatch bills a workgroup's query metrics as custom metrics, at $0.30 per metric per month for
the first 10,000 (read from the AWS Pricing API for us-east-1 on 2026-08-27). The charge is for the
metric existing, so it stays on the bill for a site nobody queries. Everything else in this pipeline
is priced by use, and a standing monthly charge to count queries would be the largest line on a
quiet site's bill.

`GetQueryExecution` reports what a query scanned and how long it took at no charge, and that is
what the command line reads.

## Removal

The workgroup goes when the stack does, taking any named queries with it (`RecursiveDeleteOption` is
on, and a workgroup holding named queries otherwise refuses to be deleted). The rollups in M3
register their named queries here, and the next deploy puts them back.

The results bucket is retained, for the reason the [log bucket](../log-bucket/) is. A bucket that
still holds objects refuses to be deleted. A `DESTROY` policy on its own therefore turns
`cdk destroy` into a CloudFormation failure. The retained bucket empties itself within `resultsRetention` and can then
be deleted by hand.

```typescript
import { RemovalPolicy } from "aws-cdk-lib/core";

new QueryWorkgroup(this, "RainlyticsQueries", {
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});
```

That pair tears the bucket down with the stack. Query results are reproducible, and the same pair
over raw logs would destroy the record every derived dataset is rebuilt from.

## Permissions for a scoped deploy role

Skippable on an account whose CloudFormation execution role holds `AdministratorAccess`.

```typescript
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

new PolicyStatement({
  sid: "TheRainlyticsWorkgroup",
  actions: [
    "athena:CreateWorkGroup",
    "athena:GetWorkGroup",
    "athena:UpdateWorkGroup",
    "athena:DeleteWorkGroup",
  ],
  resources: [`arn:aws:athena:${region}:${account}:workgroup/${workgroupName}`],
});
```

`workgroupName` is whatever was passed to the construct, and `rainlytics` by default. A policy
quoting the default against a workgroup that was renamed matches no workgroup, and the deploy fails
on a resource the statement looks like it covers.

The results bucket needs the S3 permissions on the [log bucket](../log-bucket/) page, against its
own ARN. Treat both as inferred from what the construct creates. Nothing here has been deployed with
a role narrower than `AdministratorAccess`.

## Permissions for running a query

The deploy role has no part in this one. Whoever runs the query carries it, and Athena reads the
source data and writes the results as them, so both buckets belong here alongside the workgroup.

```typescript
new PolicyStatement({
  sid: "RunningRainlyticsQueries",
  actions: [
    "athena:StartQueryExecution",
    "athena:GetQueryExecution",
    "athena:GetQueryResults",
    "athena:StopQueryExecution",
  ],
  resources: [`arn:aws:athena:${region}:${account}:workgroup/${workgroupName}`],
});
```

With `glue:GetDatabase`, `glue:GetTable` and `glue:GetPartitions` on the
[log table](../log-table/) and the catalog holding it, `s3:GetObject`, `s3:ListBucket` and
`s3:GetBucketLocation` on the log bucket, and on the results bucket `s3:PutObject`, `s3:GetObject`,
`s3:ListBucket`, `s3:GetBucketLocation`, `s3:ListBucketMultipartUploads`,
`s3:ListMultipartUploadParts` and `s3:AbortMultipartUpload`.

The multipart actions earn their place. Athena uploads a large result in parts, and this is the
list AWS documents for a query results bucket. `s3:GetObject` on results is what reads
the answer back, which `GetQueryResults` does on the caller's behalf.

This list comes from AWS's documentation rather than from a deploy. Nobody has yet run a Rainlytics
query under a policy narrower than the one their SSO role already carries.

<!-- card
```typescript
new QueryWorkgroup(this, "RainlyticsQueries", {
  bytesScannedCutoff: Size.gibibytes(10),
  resultsRetention: Duration.days(7),
});
```
-->
