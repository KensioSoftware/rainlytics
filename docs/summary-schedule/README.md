# Summary schedule

`RollupSummaries` computes common analytics questions on a schedule and writes the answers to S3.

```typescript
import { RollupSummaries } from "@kensio/rainlytics/cdk";

const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
});
```

Named CLI commands read these stored answers. Repeated reads use S3 and do not start another Athena
query.

## Default schedule

The construct computes six default questions:

- pageviews
- referrers
- browsers
- status codes
- cache hit ratio
- searches

Each question runs for hourly and daily UTC windows. A schedule starts 15 minutes after a window
closes and recomputes the two latest closed windows. Recomputing the previous window picks up logs
that CloudFront delivered late.

The same construct runs a calendar-report job once a day. It writes closed daily, weekly, monthly
and annual reports. See [Calendar reports](../reports/).

## Create the visitor salt first

The default pageview question counts visitors and reads `/rainlytics/visitor-salt` from SSM
Parameter Store. Create the `SecureString` before the first scheduled run:

```bash
aws ssm put-parameter \
  --name /rainlytics/visitor-salt \
  --type SecureString \
  --value "$(openssl rand -hex 32)"
```

Run the command in the account and region containing this construct. Pass
`visitorSaltParameter` when you use another name.

A delivery without `c-ip` creates summaries without visitor counts and needs no parameter. See
[Counting visitors](../visitors/#run-without-visitor-counts).

## Give the CLI the bucket name

The construct creates a summaries bucket unless you pass one. Output its generated name:

```typescript
import { CfnOutput } from "aws-cdk-lib";

new CfnOutput(this, "SummaryBucketName", {
  value: summaries.bucket.bucketName,
});
```

Set it in the shell that runs Rainlytics:

```bash
export RAINLYTICS_SUMMARY_BUCKET=<SummaryBucketName>
rainlytics pageviews --last 7d
```

The equivalent flag is `--summaries <bucket>`. An identity built in CDK can receive read access
with:

```typescript
summaries.grantReadingSummaries(role);
```

That grant adds `s3:GetObject` on stored summaries and KMS decryption when the bucket uses a
customer-managed key.

## Configure the questions

Pass `rollups` to add optional or custom questions:

```typescript
import { javascriptErrors, rollups, webVitals } from "@kensio/rainlytics";

const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: [...rollups, javascriptErrors, webVitals],
});
```

Optional browser questions stay out of the defaults because an access-log-only site would pay for
empty Athena queries.

Use `requests` to store a narrowed version of a question:

```typescript
const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  requests: {
    searches: { paths: ["/search/"], param: "q" },
  },
});
```

The summary records this narrowing. A CLI command that omits the same filters adopts the stored
configuration. A command that requests different filters stops and suggests `--query`.

## Configure windows and reports

```typescript
import { Duration } from "aws-cdk-lib";

const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  granularities: ["hourly", "daily"],
  lag: Duration.minutes(30),
  recomputedWindows: 3,
  reportTimeZone: "Europe/London",
  reportWeekStartsOn: "monday",
});
```

Increase `lag` if logs regularly arrive after the scheduled run. Increase `recomputedWindows` when
late delivery extends further back. Both changes increase the number of queries or delay fresh
answers.

## Cost

Every schedule invocation starts a Lambda function and at least one Athena query. S3 stores the
small JSON result. Scheduler, Lambda, Athena and S3 are all usage-priced.

The default six questions, two granularities and two-window recomputation run 300 rollup queries a
day. The pageview visitor count adds 50 more. Athena bills each query at its minimum even when the
window has no rows. At the standard 10 MB minimum and $5 per TB, those 350 queries are about 53
cents in an average month before traffic pushes a query above the minimum.

Optional questions add 50 queries a day under the same defaults. Calendar reports add period-wide
queries where stored summaries cannot be combined correctly.

There is no always-on resource or reserved capacity. A deployment with schedules still has the
minimum-query cost even when its site receives no traffic.

## Detect failed runs

A failed query stops that Lambda invocation. Other questions continue because each question has its
own schedule. Check the summary function's CloudWatch log group and Lambda error metric when a
stored window is missing.

Rainlytics does not create an alarm by default. CloudWatch alarms can add a fixed monthly charge,
so the deployment decides whether to add one.

## Run more than one deployment

Schedule names are unique in an account and region. Give another deployment a distinct prefix:

```typescript
const summaries = new RollupSummaries(this, "DocsSummaries", {
  table,
  workgroup,
  schedulePrefix: "docs-rainlytics-",
});
```

Also give its `LogTable` database and `QueryWorkgroup` unique names. Avoid prefixes where one is the
start of another if IAM policies scope schedule access by prefix.

<!-- card
```typescript
const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
});
```
-->
