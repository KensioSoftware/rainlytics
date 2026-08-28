# Summary schedule

`RollupSummaries` runs the named questions on a schedule and writes each answer to S3.

Athena prices per query, and asking the same question twice pays twice. This construct asks each
question once per window and stores the rows, so reading the answer afterwards costs a GET however
many people look. [Reading a precomputed answer](../rollups/#reading-a-precomputed-answer) has what
the command line does with what lands here.

```typescript
import {
  CloudFrontLogDelivery,
  LogBucket,
  LogTable,
  QueryWorkgroup,
  RollupSummaries,
} from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "RainlyticsLogs");
const delivery = new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: distribution.distributionId,
  logBucket: logs.bucket,
});
const table = new LogTable(this, "RainlyticsTable", { deliveries: [delivery] });
const workgroup = new QueryWorkgroup(this, "RainlyticsQueries");

new RollupSummaries(this, "RainlyticsSummaries", { table, workgroup });
```

That deploys a bucket, one Lambda function and a schedule for each question on each cadence. The
[summaries](../summaries/) page has the document those schedules produce and where it lands.

## What runs, and when

A schedule fires. EventBridge Scheduler invokes the function with the question in its target input.
The function starts the query, waits for it, and puts the rows in the bucket under the key
`summaryKey` builds. Athena does the counting, and the function starts it and stores what came back.

Two schedules per question by default, one for hours and one for days. Each hourly schedule fires
fifteen minutes into every hour, and each daily one fifteen minutes after midnight UTC. Every window
is UTC, and so is the run that computes it.

Nothing here is always-on and nothing carries a per-hour floor. Scheduler bills per invocation,
Lambda per millisecond, Athena per byte scanned and S3 per request and per byte.

## Why fifteen minutes

CloudFront delivers a request's log record some time after the request.
[#9](https://github.com/KensioSoftware/rainlytics/issues/9) measured that end to end across 200,074
records and found a median of 169 seconds and a worst case of 373. An hour's objects have therefore
all landed by four minutes past the next hour, and a run a quarter past has eleven minutes of margin
over the slowest record in that sample.

A run on the hour would compute every hour before its last records arrived. The tail of each hour
would be missing and every summary would look complete. That is the failure the lag exists to
avoid.

`lag` moves it. A site that has watched its own delivery and wants fresher answers lowers it. A site
whose logs arrive from several distributions, or whose traffic is bursty, raises it. The lag has to
be a whole number of minutes under an hour, because it decides which minute of the hour a run fires
on and an hour is the shortest window stored.

```typescript
new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  lag: Duration.minutes(25),
});
```

## Why each run computes two windows

A record CloudFront delivers after its window was computed is invisible to every reader until
something computes that window again. A job that only ever wrote the window that had just closed
never would, and the summary would go on being quietly short for as long as it lived.

So a run computes the window that has just closed and the one before it, newest first. Both are
written to the keys they were written to before, and each replaces what was there. Recomputing a
window is a re-run of the job. A bug in a rollup is a re-run too.

`recomputedWindows` moves that count. One computes each window once and never again. Higher numbers
buy more grace at one Athena query each.

Nothing backfills. A run reaches back as far as `recomputedWindows` and no further, so a window that
closed before the construct was deployed has no summary and reports as `neverComputed` to whatever
reads the bucket. Answering a question about one of those is a `rainlytics` query over raw.

```typescript
new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  recomputedWindows: 3,
});
```

## What it costs

One Athena query per window per question per run. Athena bills a ten million byte minimum whatever a
query reads. That is $0.00005 a query (the [query](../query/) page has where the per-byte figure
comes from).

The five shipped questions on both cadences, recomputing two windows, come to 250 queries a day.
That is about 38 cents a month, plus a few cents of Lambda and a rounding error of S3. The default
`recomputedWindows` of 2 doubles the query cost and leaves the object count alone, since a
recomputed window overwrites its own key.

Lowering `recomputedWindows` to 1 halves the Athena bill. Computing hours alone, with
`granularities: ["hourly"]`, is the other lever, at the price of a reader assembling a day out of 24
objects.

A question that counts visitors runs a second query per window. `pageviews` does, which adds 50
queries a day to the 250 above and about 8 cents a month. [Counting visitors](../visitors/) has what
that number means.

## Reading the query a schedule runs

The SQL is written at synthesis by the same builder the `rainlytics` command uses, with the window
left as a placeholder the job fills in when it runs. It is in the CloudFormation template and in the
schedule's target input, so what the job will run can be read without running it.

A scheduled summary of one hour and a `rainlytics pageviews --last 1h` run over that hour therefore
count it the same way. The [rollups](../rollups/) page has what each question counts.

The query is fixed at deploy time. A package upgrade that changes what a question counts reaches the
running job when the stack is deployed again, and the same deploy replaces the function's code.

Each question also takes the narrowing `RollupQueries` takes, per question and by name:

```typescript
const site = { host: "docs.example.com" };

new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  requests: {
    pageviews: site,
    searches: { ...site, paths: ["/search/"], param: "term" },
  },
});
```

The narrowing is recorded in every summary the question produces, so a reader can see that an answer
is a narrower one than they asked for. Only the question's name reaches the key, so two narrowings of
one question want [two rollups with two names](../rollups/#writing-a-rollup-of-your-own). A pair
sharing a name is refused at synthesis, because both would write to one key and whichever ran last
would be the answer.

## When a run fails

A query that does not succeed fails the run. The message names the question, the window, Athena's own
reason and the execution id, and it goes to the function's log group. The invocation counts on the
function's `Errors` metric.

The bytes-scanned cutoff is the failure worth expecting. It is `bytesScannedCutoff` on the
[workgroup](../query-workgroup/), and it is there so one query cannot run up a bill nobody chose. A
scheduled question reads one window and should be nowhere near the ceiling. A run that meets it has
usually lost its partition predicate, which the message says.

Nobody is watching a scheduled run, and there are two places to look:

- **The bucket.** A window with no object is one nobody computed. A window with an object holding no
  rows saw no traffic. Summaries that stop appearing are the visible half of a job that stopped
  working, and the [summaries](../summaries/) page has the three answers a reader meets.
- **The log group.** `/aws/lambda/<function>`, kept for a month by default and moved with
  `logRetention`.

A CloudWatch alarm over the error metric is the thing that would tell somebody without their having
to look, and it is the one piece of this that carries a fixed monthly charge. That is why the
construct does not create one. A site that wants the notification more than it wants the constraint
adds an alarm over the function it gets back:

```typescript
const summaries = new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
});

summaries.lambda.metricErrors().createAlarm(this, "SummariesFailing", {
  threshold: 1,
  evaluationPeriods: 1,
});
```

## Where the summaries go

A bucket of its own, created by the construct and available as `summaries.bucket`. Its own bucket and
never the log bucket, because the logs expire on a retention measured in months and the answers
computed from them outlive the records.

It carries no expiry rule. A year of five questions on both cadences is about 45,000 objects of a few
kilobytes, and a summary is the only remaining record of a window once the raw objects have gone.

Pass `summariesBucket` to write into one of your own. That is worth doing where something outside
this stack reads the answers, such as a static site given read access to one prefix.

## Props

| Prop                   | Default                    | What it decides                                    |
| ---------------------- | -------------------------- | -------------------------------------------------- |
| `table`                | required                   | The Glue table the questions read.                 |
| `workgroup`            | required                   | Where the queries run, and their cutoff.           |
| `rollups`              | the five shipped questions | What to compute.                                   |
| `requests`             | none                       | What each question covers.                         |
| `granularities`        | `["hourly", "daily"]`      | Which windows to compute.                          |
| `lag`                  | 15 minutes                 | How long after a window closes a run fires.        |
| `recomputedWindows`    | 2                          | How many closed windows a run computes.            |
| `summariesBucket`      | one is created             | Where the answers land.                            |
| `visitorSaltParameter` | `/rainlytics/visitor-salt` | The SSM parameter holding the visitor salt secret. |
| `timeout`              | 5 minutes                  | How long one run may take.                         |
| `logRetention`         | a month                    | How long the function's logs are kept.             |
| `schedulePrefix`       | `rainlytics-`              | What each schedule's name begins with.             |

## Two deployments in one account

A schedule's name is unique within its group, and every schedule here goes in the account's default
group. A second Rainlytics deployment in the same account and Region therefore meets the first one's
`rainlytics-pageviews-hourly` and fails at deploy time. `schedulePrefix` is how the second one says
which it is:

```typescript
new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  schedulePrefix: "docs-",
});
```

The same holds for `workgroupName` on the [workgroup](../query-workgroup/) and `databaseName` on the
[table](../log-table/). One deployment per account reads well by default, and a second one names
itself.

## Questions of your own

A rollup a site wrote is scheduled like a shipped one, and its SQL comes from the same builder:

```typescript
new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  rollups: [...rollups, countries],
});
```

[Writing a rollup of your own](../rollups/#writing-a-rollup-of-your-own) has what a question has to
do. The one rule this construct adds is that the question builds its `WHERE` clause with `rowsFor`,
because that is what writes the window the job fills in. A query that reaches Athena without one is
refused before it is sent, since Athena would take it and read every partition the table projects.

<!-- card
```typescript
new RollupSummaries(this, "RainlyticsSummaries", { table, workgroup });
```
-->
