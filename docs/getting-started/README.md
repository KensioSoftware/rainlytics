# Getting started

This guide deploys Rainlytics for one existing CloudFront distribution and reads the first stored
pageview report.

You need:

- Node.js 22 or newer
- an AWS CDK app written in TypeScript
- a deployed CloudFront distribution
- AWS credentials that can deploy the resources in this guide

Rainlytics configures CloudFront standard logging v2 through the CloudWatch Logs API in
`us-east-1`. The example keeps the log bucket, Glue table, Athena workgroup and scheduled jobs in
that region too.

## Install Rainlytics

Add Rainlytics to your CDK app. Most CDK apps already have the two peer dependencies.

```bash
pnpm add @kensio/rainlytics aws-cdk-lib constructs
```

The package also installs the `rainlytics` command.

## Create the visitor salt

The default pageview rollup counts visitors. It derives daily identifiers from a secret stored as
an SSM Parameter Store `SecureString`.

Create the secret once in the account and region where the scheduled jobs will run:

```bash
aws ssm put-parameter \
  --region us-east-1 \
  --name /rainlytics/visitor-salt \
  --type SecureString \
  --value "$(openssl rand -hex 32)"
```

Use your normal AWS CLI profile or role for this command. Rainlytics never writes the secret to a
CloudFormation template. Keep the parameter after deployment because recomputing an old period
requires the same secret.

You can omit this step by excluding viewer addresses from log delivery. See [Counting
visitors](../visitors/#run-without-visitor-counts).

## Add an analytics stack

Create a stack like this in your CDK app. Replace the distribution ID with your own.

```typescript
import { App, CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import {
  CloudFrontLogDelivery,
  LogBucket,
  LogTable,
  QueryWorkgroup,
  RollupQueries,
  RollupSummaries,
} from "@kensio/rainlytics/cdk";

class AnalyticsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const logs = new LogBucket(this, "Logs");

    const delivery = new CloudFrontLogDelivery(this, "Delivery", {
      distributionId: "E1EXAMPLE1234",
      logBucket: logs.bucket,
    });

    const table = new LogTable(this, "Table", {
      deliveries: [delivery],
    });

    const workgroup = new QueryWorkgroup(this, "Workgroup");

    new RollupQueries(this, "SavedQueries", { table, workgroup });

    const summaries = new RollupSummaries(this, "Summaries", {
      table,
      workgroup,
    });

    new CfnOutput(this, "SummaryBucketName", {
      value: summaries.bucket.bucketName,
    });
  }
}

const app = new App();

new AnalyticsStack(app, "Analytics", {
  env: {
    account: process.env["CDK_DEFAULT_ACCOUNT"],
    region: "us-east-1",
  },
});
```

This stack creates:

- a private, versioned S3 bucket for raw logs
- a CloudFront log delivery with hourly Hive partitions
- a Glue database and projected table
- an Athena workgroup with a per-query scan limit
- saved versions of the built-in rollup queries
- scheduled summary and calendar-report jobs
- a second S3 bucket for stored answers

The log bucket is the source of record. Its objects are retained for 370 days by default. The
summary and query result buckets are separate because they hold derived data with different
retention rules.

## Synthesize and deploy

Check the template before deployment:

```bash
pnpm exec cdk synth Analytics
pnpm exec cdk diff --method=template Analytics
pnpm exec cdk deploy Analytics
```

The deploy prints `SummaryBucketName`. Keep that value for the command line.

CloudFront can take up to 12 hours to apply a logging change. New log objects then appear under a
path like this:

```text
s3://<log-bucket>/rainlytics/distributionid=E1EXAMPLE1234/year=2026/month=09/day=01/hour=14/
```

The first scheduled summary is written after a complete hour closes and CloudFront delivers its
logs. A new deployment therefore has no immediate historical summaries.

## Run the command line

Set the region and summary bucket in your shell:

```bash
export AWS_REGION=us-east-1
export RAINLYTICS_SUMMARY_BUCKET=<SummaryBucketName>
```

Run a named question:

```bash
pnpm exec rainlytics pageviews --last 24h
```

The command reads your AWS credentials from the standard SDK credential chain. It prints a table at
a terminal and JSON when piped.

```bash
pnpm exec rainlytics pageviews --last 24h | jq '.[0]'
pnpm exec rainlytics status-codes --last 24h --output csv > status-codes.csv
```

Named questions read the precomputed objects in the summary bucket. Add `--query` to calculate the
answer directly from the raw logs with Athena:

```bash
pnpm exec rainlytics pageviews --last 2h --query
```

An Athena query needs write access to the workgroup's results bucket and query permissions that a
read-only role usually lacks. The [Query workgroup](../query-workgroup/#grant-query-access) page
shows how to grant the complete set from CDK.

## Add the browser beacon

The access-log pipeline is complete at this point. Add the browser module only when you need SPA
route changes, custom events, Web Vitals or JavaScript errors.

`BeaconPath` must be added where your CDK app has the `Distribution` and its origin:

```typescript
import { BeaconPath } from "@kensio/rainlytics/cdk";

new BeaconPath(this, "AnalyticsBeacon", {
  distribution,
  origin,
});
```

Start the browser module in your site's existing JavaScript bundle:

```typescript
import { startBeacon } from "@kensio/rainlytics/beacon";

const beacon = startBeacon();
beacon.report({ event: "signup", page: location.pathname });
```

The collection path defaults to `/_rainlytics`. The CDK construct and browser module must use the
same path. Continue with [Browser beacon](../beacon/) for Core Web Vitals, error reporting, consent
and custom event rollups.

## Next steps

- Read [Rollups](../rollups/) for every built-in question and filter.
- Read [Command line](../command-line/) for profiles, output formats and reports.
- Adjust raw log retention in [Log bucket](../log-bucket/).
- Review visitor data handling in [Counting visitors](../visitors/).
- Review costs and failure checks in [Summary schedule](../summary-schedule/).

<!-- card
```bash
pnpm exec rainlytics pageviews --last 24h
```
-->
