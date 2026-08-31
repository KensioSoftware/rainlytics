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

The six default questions on both cadences, recomputing two windows, come to 300 queries a day.
That is about 45 cents a month, plus a few cents of Lambda and a rounding error of S3. The default
`recomputedWindows` of 2 doubles the query cost and leaves the object count alone, since a
recomputed window overwrites its own key.

Lowering `recomputedWindows` to 1 halves the Athena bill. Computing hours alone, with
`granularities: ["hourly"]`, is the other lever, at the price of a reader assembling a day out of 24
objects.

A question that counts visitors runs a second query per window. `pageviews` does, which adds 50
queries a day to the 300 above and about 8 cents a month. [Counting visitors](../visitors/) has what
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
- **The log group.** One of its own, kept for a month by default and moved with `logRetention`.

CloudFormation names that log group after the stack and the logical id. The name comes out
something like `MyStack-RainlyticsSummariesJobLogs1C6CB09C-8mKvQ2XrTpLd`. The
`/aws/lambda/<function name>` a Lambda function's logs usually sit under holds nothing here. The
function's **Monitor** tab in the Lambda console links to the right group, and that is the quickest
way to it. From a terminal, ask the stack:

```bash
aws cloudformation describe-stack-resources --stack-name MyStack \
  --query "StackResources[?ResourceType=='AWS::Logs::LogGroup'].PhysicalResourceId"
```

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

It carries no expiry rule. A year of six questions on both cadences is about 55,000 objects of a few
kilobytes, and a summary is the only remaining record of a window once the raw objects have gone.

Pass `summariesBucket` to write into one of your own. That is worth doing where something outside
this stack reads the answers, such as a static site given read access to one prefix.

## Props

| Prop                   | Default                    | What it decides                                    |
| ---------------------- | -------------------------- | -------------------------------------------------- |
| `table`                | required                   | The Glue table the questions read.                 |
| `workgroup`            | required                   | Where the queries run, and their cutoff.           |
| `rollups`              | the six default questions  | What to compute.                                   |
| `requests`             | none                       | What each question covers.                         |
| `granularities`        | `["hourly", "daily"]`      | Which windows to compute.                          |
| `lag`                  | 15 minutes                 | How long after a window closes a run fires.        |
| `recomputedWindows`    | 2                          | How many closed windows a run computes.            |
| `summariesBucket`      | one is created             | Where the answers land.                            |
| `visitorSaltParameter` | `/rainlytics/visitor-salt` | The SSM parameter holding the visitor salt secret. |
| `timeout`              | 5 minutes                  | How long one run may take.                         |
| `logRetention`         | a month                    | How long the function's logs are kept.             |
| `schedulePrefix`       | `rainlytics-`              | What each schedule's name begins with.             |

A default deployment reads the salt parameter. `pageviews` counts visitors, and it is one of the six
questions above. The `SecureString` has to be in Parameter Store before the first run ([creating the
secret](../visitors/#creating-the-secret) has the command). A deployment that wants none passes
`rollups` without a question that counts visitors, and never reads the parameter.

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

## Permissions for a scoped deploy role

Skippable on an account whose CloudFormation execution role holds `AdministratorAccess`.

This construct creates more kinds of resource than the rest of the pipeline. A deploy of the
defaults writes ten schedules, one function, one log group, two roles with an inline policy each,
and a bucket with a bucket policy. `scheduler:` is the prefix to check first. A role that has
deployed anything else in the account usually holds the rest already.

```typescript
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

new PolicyStatement({
  sid: "TheRainlyticsSummarySchedules",
  actions: [
    "scheduler:CreateSchedule",
    "scheduler:GetSchedule",
    "scheduler:UpdateSchedule",
    "scheduler:DeleteSchedule",
  ],
  resources: [
    `arn:aws:scheduler:${region}:${account}:schedule/default/${schedulePrefix}*`,
  ],
});
```

`default` is the schedule group every schedule here goes in, and the names after it begin with
`schedulePrefix` (`rainlytics-` unless it was passed). The wildcard therefore covers one
deployment's schedules and leaves whatever else the account has scheduled alone.

It matches on the prefix and nothing else. A second deployment that called itself `rainlytics-docs-`
would sit inside a statement quoting `rainlytics-*`, and the first deployment's role could update
and delete its schedules. Give the second one a prefix that is not the opening of the first one's.

The function, its log group and the two roles:

```typescript
new PolicyStatement({
  sid: "TheRainlyticsSummaryFunction",
  actions: [
    "lambda:CreateFunction",
    "lambda:GetFunction",
    "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration",
    "lambda:DeleteFunction",
  ],
  resources: [`arn:aws:lambda:${region}:${account}:function:${stackName}-*`],
});

new PolicyStatement({
  sid: "TheRainlyticsSummaryLogs",
  actions: [
    "logs:CreateLogGroup",
    "logs:PutRetentionPolicy",
    "logs:DeleteLogGroup",
  ],
  resources: [`arn:aws:logs:${region}:${account}:log-group:${stackName}-*`],
});

new PolicyStatement({
  sid: "TheRainlyticsSummaryLogGroups",
  actions: ["logs:DescribeLogGroups"],
  resources: ["*"],
});

new PolicyStatement({
  sid: "TheRainlyticsSummaryRoles",
  actions: [
    "iam:CreateRole",
    "iam:GetRole",
    "iam:DeleteRole",
    "iam:PutRolePolicy",
    "iam:GetRolePolicy",
    "iam:DeleteRolePolicy",
    "iam:AttachRolePolicy",
    "iam:DetachRolePolicy",
    "iam:PassRole",
  ],
  resources: [`arn:aws:iam::${account}:role/${stackName}-*`],
});
```

`logs:DescribeLogGroups` is the one that has to be `*`. CloudFormation reads a log group back with
it, and IAM gives the action no resource type at all, so a statement naming a log group authorises
it for no request. The other three actions are scoped to the group.

`iam:PassRole` is the one that looks like surplus. `lambda:CreateFunction` hands Lambda the role the
function runs as, and `scheduler:CreateSchedule` hands Scheduler the role it invokes through. A
policy that creates both roles and stops there fails on the first of those two calls.
`iam:AttachRolePolicy` is for `AWSLambdaBasicExecutionRole`, the managed policy CDK attaches to
every function's role.

The function, its log group and both roles are left unnamed, and CloudFormation names each of them
after the stack and the logical id. That is where `${stackName}-*` comes from above, and the
truncation trap on the [log bucket](../log-bucket/) page applies to all three. Check the prefix
against the names a deploy created rather than against the stack name alone.

The created bucket takes the S3 permissions on that same page against its own ARN, its bucket policy
included (`enforceSSL` writes one). A deployment passing `summariesBucket` creates no bucket and
needs none of them.

The function's code goes up under a different role. `cdk deploy` uploads the asset with the
bootstrap file publishing role before CloudFormation runs. A deploy that fails on the upload is a
bootstrap question.

Read the whole list as inferred from what the construct creates. The resource counts above come
from synthesising the defaults, and no deploy has run under a role narrower than
`AdministratorAccess`. So the actions have never been tested against the failure a missing one would
cause.

## Permissions for a scheduled run

The deploy role has no part in these. The construct grants them itself, onto the role the function
runs as, and a reader under a narrowed deploy role has no policy to write for them. They are here
because a service control policy denies an unlisted prefix whichever role sent the call, and the
deploy list above is half of what such an account has to allow.

One run sends:

- `athena:StartQueryExecution`, `StopQueryExecution`, `GetQueryExecution` and `GetQueryResults` on
  the workgroup, with `athena:GetWorkGroup` alongside them (Athena reads the workgroup's own
  configuration on the way to running a query in it).
- `glue:GetDatabase`, `glue:GetTable` and `glue:GetPartitions` on the catalog, the database and the
  table.
- `s3:GetObject`, `s3:GetBucketLocation` and `s3:ListBucket` on the log bucket and its objects.
  Athena lists the prefixes a partition predicate selected before it reads anything in them.
- On the workgroup's results bucket and its objects, what CDK's `grantReadWrite` writes.
  `s3:GetObject*`, `s3:GetBucket*`, `s3:List*`, `s3:DeleteObject*`, `s3:PutObject` with its
  `LegalHold`, `Retention`, `Tagging` and `VersionTagging` variants, and `s3:Abort*`. Athena writes
  each query's output there as the caller and reads it back to answer `GetQueryResults`.
- The same `PutObject` family and `s3:Abort*` again on the summaries bucket's objects, from
  `grantPut`.
- `ssm:GetParameter` on the visitor salt parameter.

Those are the statements on the deployed role read back off a synthesised template, rather than a
list inferred from the code.

An account that allows the deploy prefixes and stops there deploys cleanly and fails on the first
schedule that fires. Nobody is watching that run. The message lands in the function's log group and
the summaries never start appearing. That is the harder of the two failures to attribute.

`ssm:GetParameter` reads a parameter no template creates. The salt is a `SecureString`, and
CloudFormation writes `String` and `StringList` parameters only. Somebody puts it there by hand
before the first run that counts visitors, and [creating the
secret](../visitors/#creating-the-secret) has the command.

<!-- card
```typescript
new RollupSummaries(this, "RainlyticsSummaries", { table, workgroup });
```
-->
