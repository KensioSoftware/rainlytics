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
will read.

```typescript
import { CloudFrontLogDelivery, LogBucket } from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "RainlyticsLogs");

new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});
```

That stack has to be in us-east-1, which is the only region CloudFront log
delivery can be configured from. See the [log bucket](docs/log-bucket/) and [log
delivery](docs/log-delivery/) pages.

A `rainlytics` command ships beside them, and runs with nothing else
installed:

```bash
npx @kensio/rainlytics --help
```

It authenticates through the AWS SDK's default credential chain and writes
JSON, CSV or a table, defaulting to the table at a terminal and to JSON when
it is piped. So far it explains itself and little else, and querying arrives
next. See the [command line](docs/command-line/) page.

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
