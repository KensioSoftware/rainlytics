# Rainlytics

Rainlytics is self-hosted web analytics for sites served by Amazon CloudFront.

It collects most measurements from CloudFront access logs. Your pages need no analytics
JavaScript, no third-party script tag and no connection to an analytics provider. Raw logs and
derived reports stay in your AWS account.

An optional browser module records SPA route changes, custom events, Core Web Vitals and JavaScript
errors. The module goes into your existing bundle and sends events to your own domain.

[Read the documentation](https://rainlytics.com) or follow [Getting started](docs/getting-started/)
to deploy the first working pipeline.

## How it works

CloudFront standard logging v2 writes access logs to S3. Rainlytics creates a Glue table over those
objects and uses partition projection, so there is no Glue crawler. Athena computes common
questions on a schedule. The results are stored as small JSON summaries in S3.

The command line reads those summaries:

```bash
rainlytics pageviews --last 7d
```

```text
path         views
-----------  -----
/              412
/articles/     208
/pricing/       97
```

Reading a stored answer costs one S3 GET per summary window. Use `--query` when you need Athena to
calculate a fresh answer from the raw logs.

```bash
rainlytics pageviews --last 2h --query
```

Rainlytics has no dashboard. The command line uses the AWS SDK credential chain, including AWS IAM
Identity Center profiles, assumed roles and workload credentials. Output is a table at a terminal
and JSON in a pipe. CSV is available with `--output csv`.

## What Rainlytics reports

The default scheduled questions cover:

- pageviews by path
- referrers by host
- browsers and device classes
- HTTP status codes
- CloudFront cache hit ratio
- search terms from a search page

The same deployment also writes reports for closed days, weeks, months and years.

```bash
rainlytics report month 2026-08 --compare
```

The browser module can add route changes and custom events. Separate imports collect Core Web
Vitals and uncaught JavaScript errors, so sites only download the features they use.

```typescript
import { startBeacon } from "@kensio/rainlytics/beacon";
import { reportErrors } from "@kensio/rainlytics/beacon/errors";
import { reportVitals } from "@kensio/rainlytics/beacon/vitals";

const beacon = startBeacon();

reportVitals(beacon);
reportErrors(beacon, {
  redact: (message) => message.replace(/\S+@\S+/gu, "[email]"),
});

beacon.report({ event: "signup", page: location.pathname });
```

The browser sends a GET to `/_rainlytics` on the site's domain. A CloudFront Function returns 204
before the request reaches the cache or origin. CloudFront records the event in the same access log
as every other request.

## AWS resources

Rainlytics ships CDK constructs from `@kensio/rainlytics/cdk`:

- `LogBucket` stores the raw CloudFront logs.
- `CloudFrontLogDelivery` configures standard logging v2.
- `LogTable` creates the Glue database and projected table.
- `QueryWorkgroup` adds an Athena scan limit and a results bucket.
- `RollupQueries` saves the generated SQL in Athena.
- `RollupSummaries` schedules rollups and calendar reports.
- `BeaconPath` adds the optional first-party collection path.

The pipeline uses S3, Glue, Athena, Lambda, EventBridge Scheduler and CloudFront. These services are
priced by requests, bytes or execution time. Rainlytics creates no server, provisioned database,
stream or cluster with an hourly capacity charge.

Scheduled Athena queries still have a minimum billed scan, including on a site with no traffic.
See [Summary schedule](docs/summary-schedule/) for the query count and cost model.

## Package entry points

```typescript
import { pageviews, rollups } from "@kensio/rainlytics";
import { LogBucket, RollupSummaries } from "@kensio/rainlytics/cdk";
import { startBeacon } from "@kensio/rainlytics/beacon";
import { reportVitals } from "@kensio/rainlytics/beacon/vitals";
import { reportErrors } from "@kensio/rainlytics/beacon/errors";
```

The CDK dependencies are optional peers. Installing Rainlytics for its command line or browser
module does not install `aws-cdk-lib` or `constructs` unless your project requests them.

## Project status

Rainlytics is experimental and pre-1.0. Its construct and command interfaces can change without a
major version. The maintainer currently runs it on their own sites.

Rainlytics is written by [Kensio Software](https://kensiosoftware.co.uk). Issues and bug reports are
welcome. Pull requests are closed so the project retains a single copyright holder.

## License

Apache 2.0. See [LICENSE](LICENSE).

Rainlytics is an independent open-source project. Amazon and AWS do not sponsor, endorse or
affiliate with it. The name is a reference to rainforests.
