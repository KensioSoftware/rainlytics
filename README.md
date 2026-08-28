# Rainlytics

Self-hosted web analytics for AWS sites, built on CloudFront logs.

[rainlytics.com](https://rainlytics.com "Rainlytics documentation")

Rainlytics runs the whole analytics pipeline inside your own AWS account. Most
of what it reports is derived from the CloudFront access logs your distribution
already writes. A measured page downloads no analytics JavaScript, opens no
extra connection, and resolves no extra hostname.

An optional beacon covers what an access log cannot see accurately, such as
route changes in a single-page app, Core Web Vitals, custom events and
JavaScript errors. It is bundled into the site's own JavaScript and reports back
through the site's own domain (no second host, no separate script tag).

Everything runs on usage-priced AWS services, batched and precomputed on a
schedule rather than processed per request. Nothing in the pipeline is always
on, and a low-traffic site should cost cents a month.

## What works today

CDK constructs for the collection half of the pipeline. A distribution's access
logs land in an S3 bucket, partitioned and carrying the field set the rollups
will read, and a Glue table describes them for Athena.

```typescript
import {
  CloudFrontLogDelivery,
  LogBucket,
  LogTable,
  QueryWorkgroup,
} from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "RainlyticsLogs");

const delivery = new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});

new LogTable(this, "RainlyticsTable", { deliveries: [delivery] });
new QueryWorkgroup(this, "RainlyticsQueries");
```

The table projects its partitions, so a query naming a day reads that day and
is billed for those bytes. No crawler runs over the bucket and no partition is
ever registered.

The workgroup bounds what one query may scan. Athena bills per byte and says
nothing at the time, so a query that names no partition is the one mistake here
that costs money quietly. It fails at the point it is run instead.

That stack has to be in us-east-1, which is the only region CloudFront log
delivery can be configured from. See the [log bucket](docs/log-bucket/), [log
delivery](docs/log-delivery/), [log table](docs/log-table/) and [query
workgroup](docs/query-workgroup/) pages.

A `rainlytics` command ships beside them, and answers the questions people
ask most without any SQL:

```bash
npx @kensio/rainlytics pageviews --last 7d
```

```text
path         views
-----------  -----
/              412
/liju/         208
/grammar/       97
```

`referrers`, `status-codes` and `cache-hit-ratio` are the others, `searches`
counts what people typed into a search box, and `query` takes SQL for anything
else. Crawlers are left out by default, which on the reference site is 39% of
the traffic in a typical hour.

It authenticates through the AWS SDK's default credential chain and writes
JSON, CSV or a table, defaulting to the table at a terminal and to JSON when
it is piped. What a run read and what that came to goes to standard error, so
a pipeline reads rows and a person still sees the price. See the [command
line](docs/command-line/), [rollups](docs/rollups/),
[searches](docs/searches/) and [query](docs/query/) pages.

One more construct runs those questions on a schedule and writes each answer
to S3:

```typescript
new RollupSummaries(this, "RainlyticsSummaries", { table, workgroup });
```

Each question is asked once per hour and once per day, on a lag long enough
for CloudFront to have delivered the window. The named questions above then
read those answers, and a week of pageviews costs 29 GETs and about a
hundredth of a cent. `--query` sends the question to Athena for a fresher
answer, at what a query costs. See the [summary
schedule](docs/summary-schedule/) and [rollup summaries](docs/summaries/)
pages.

## Status

Experimental and pre-1.0. The construct API changes without a major version
behind it, and the only consumer so far is the maintainer's own sites.

## Links

[rainlytics.com](https://rainlytics.com) is the canonical home.
`rainlytics.dev`, `rainlytics.net` and `rainlytics.app` redirect to it.

Rainlytics is written by [Kensio Software](https://kensiosoftware.co.uk) alone.
Sole authorship is what leaves the licence and the direction free to change
later, so pull requests are closed. Issues and bug reports are welcome.

## License

Apache 2.0. See [LICENSE](LICENSE).

Rainlytics is an independent open-source project with no affiliation with,
sponsorship from, or endorsement by Amazon or AWS. The name is a nod to
rainforests.
