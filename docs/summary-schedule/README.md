# Summary schedule

`RollupSummaries` schedules Athena queries and writes their results to S3 as JSON summaries. Each
summary covers one question over a completed hour or day.

```typescript
import { RollupSummaries } from "@kensio/rainlytics/cdk";

const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
});
```

Named CLI commands read these stored summaries with S3 GET requests.

## Default schedule

The construct computes six default questions:

- pageviews
- referrers
- browsers
- status codes
- cache hit ratio
- searches

Each question has an hourly and a daily schedule, both using UTC. A run starts 15 minutes after
the hour or day ends and computes the two most recently completed windows. This includes a second
attempt at the previous window to pick up logs delivered late by CloudFront.

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

The summary records its filters. A CLI command that omits those filters uses the stored settings.
A command that requests different filters stops and suggests `--query`.

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

Increase `lag` to wait longer for logs before running a query. Increase `recomputedWindows` to
revisit more previous windows. A longer lag delays new summaries. More recomputed windows increase
the number of queries.

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

## Backfill missed windows

A scheduled run computes the windows that have just closed. A window whose run failed stays missing
after the next run succeeds. The raw logs are still in the log bucket for as long as its lifecycle
keeps them, and the summaries can be computed from them afterwards. Fix whatever made the runs fail
first, such as a missing visitor salt. Then backfill the summaries, and then the reports.

### 1. Backfill the summaries

Run `rainlytics backfill` once for each question and granularity that has a gap:

```bash
rainlytics backfill pageviews hourly --from 2026-09-11 --until 2026-10-12
rainlytics backfill pageviews daily --from 2026-09-11 --until 2026-10-12
```

`--from` and `--until` take a date (midnight UTC) or an ISO 8601 instant with its offset. `--until`
is outside the range and defaults to now. Every window that overlaps the range and has closed is
computed. Pass `--schedule-prefix` where the deployment set `schedulePrefix`.

The command reads the question's schedule and invokes the summary function with the schedule's own
payload plus the range. The function computes each window with the code and SQL a scheduled run
uses, and writes it under the same key. Running a backfill twice writes the same summaries again.

One invocation computes windows oldest first and stops before the function's timeout. It answers
with the payload that carries on from the next window, and the command invokes again with it until
the range is done. A month of hourly windows takes several invocations at the default five-minute
timeout. Each one is reported on standard error. After a failure, run the command again with
`--from` set to where the last report reached.

The identity running the command needs `scheduler:GetSchedule` on the schedule and
`lambda:InvokeFunction` on the summary function. The function queries and writes with its own role.

Each window runs one Athena query, and a second for a question that counts visitors. The command
prints the window count and the minimum Athena charge before it starts. A month of hourly pageviews
is 744 windows and 1,488 queries, about 7 cents at the 10 MB minimum.

The same backfill works without the CLI. Add a `backfill` field to the schedule's input and invoke
the function synchronously:

```bash
aws scheduler get-schedule --name rainlytics-pageviews-hourly \
  --query Target.Input --output text \
  | jq '.backfill = {from: "2026-09-11T00:00:00Z", until: "2026-10-12T00:00:00Z"}' \
  > backfill.json
aws lambda invoke \
  --function-name "$(aws scheduler get-schedule --name rainlytics-pageviews-hourly --query Target.Arn --output text)" \
  --cli-read-timeout 0 --cli-binary-format raw-in-base64-out \
  --payload file://backfill.json progress.json
```

`progress.json` lists the windows written under `computed`. Where it has a `next` field, invoke again
with that as the payload. `--cli-read-timeout 0` stops the AWS CLI giving up after its default 60
seconds while the function is still working.

### 2. Backfill the reports

A calendar report composes its sections from the stored summaries. A report written before its
summaries existed has empty sections, so the reports come second. The report schedule's input
carries `recomputedDays`, the number of closed local days each run rewrites along with any week,
month or year ending on them. Invoke the report function once with that raised to cover the gap:

```bash
aws scheduler get-schedule --name rainlytics-_reports-daily \
  --query Target.Input --output text \
  | jq '.recomputedDays = 41' > reports.json
aws lambda invoke \
  --function-name "$(aws scheduler get-schedule --name rainlytics-_reports-daily --query Target.Arn --output text)" \
  --cli-read-timeout 0 --cli-binary-format raw-in-base64-out \
  --payload file://reports.json reports-out.json
```

Count the days back from today to the first missing one. The report function has a 15-minute
timeout, and its log group records each report as it is written. Report
notifications only cover periods ending on the most recent closed day, and a manifest that already
exists is left alone.

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
