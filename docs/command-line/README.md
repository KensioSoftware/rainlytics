# Command line

The `rainlytics` command reads analytics from your AWS account.

```bash
pnpm exec rainlytics --help
```

You can also run the package without installing it in a project:

```bash
npx @kensio/rainlytics --help
```

Authentication uses your existing AWS credentials.

## Credentials and region

The command uses the AWS SDK default credential chain. It supports named AWS profiles, IAM Identity
Center sessions, assumed roles, environment credentials and workload roles.

Choose a profile and region with the normal AWS settings:

```bash
AWS_PROFILE=analytics AWS_REGION=us-east-1 rainlytics pageviews --last 7d
```

Every command that reaches AWS also accepts `--region`. Athena commands accept `--database` and
`--workgroup` when the deployment changed their defaults.

The region must contain the Glue table, Athena workgroup and summary bucket. A missing workgroup in
the selected region is often a profile or region mistake.

## Select your deployment

Use these environment variables or command options to select the deployed resources. The database
and workgroup have default names. Stored reads always need a summary bucket name:

| Variable                    | Option        | Default      |
| --------------------------- | ------------- | ------------ |
| `RAINLYTICS_DATABASE`       | `--database`  | `rainlytics` |
| `RAINLYTICS_WORKGROUP`      | `--workgroup` | `rainlytics` |
| `RAINLYTICS_SUMMARY_BUCKET` | `--summaries` | none         |

```bash
export RAINLYTICS_DATABASE=analytics
export RAINLYTICS_WORKGROUP=analytics
export RAINLYTICS_SUMMARY_BUCKET=rainlytics-summaries-1a2b
rainlytics pageviews --last 7d
```

Command options override environment variables. `RollupSummaries` uses the same variable names
for its scheduled jobs.

## Read a named question

The named commands cover pageviews, referrers, browsers, status codes, cache hit ratio, searches,
JavaScript errors and Web Vitals.

```bash
rainlytics pageviews --last 7d
rainlytics referrers --last 30d
rainlytics status-codes --last 24h --include-bots
```

These commands read precomputed summaries. Name the bucket with an option or environment variable:

```bash
rainlytics pageviews --last 7d --summaries rainlytics-summaries-1a2b

export RAINLYTICS_SUMMARY_BUCKET=rainlytics-summaries-1a2b
rainlytics pageviews --last 7d
```

Use `--query` to run the same question against raw logs with Athena:

```bash
rainlytics pageviews --last 2h --query
```

This runs an Athena query over the available raw logs and incurs query cost. Missing summaries
never trigger an automatic Athena query.

## Name the days to read

`--last` measures back from now. Its two ends fall part-way through an hour, so it never reads
exactly one stored day. Name the days instead with `--day`, or with `--from` and `--until`:

```bash
rainlytics pageviews --day 2026-10-11
rainlytics referrers --from 2026-10-01 --until 2026-11-01
```

`--day` is one UTC day, from its midnight to the next. `--from` and `--until` take a date for
midnight UTC or an ISO 8601 instant with its offset, written as for `backfill`. `--until` is outside
the span and defaults to now, so the second example is October. A span written in whole days reads
whole stored days. Use one of `--last`, `--day` or `--from` on a command line, never two.

A conversion rate answers from one stored window, because visitor counts from two windows cannot be
added. `--day` reads one stored day of it:

```bash
rainlytics conversions-purchase --day 2026-10-11
```

The filters still apply. `--day 2026-10-11 --country GB` reads the day of the summary computed for
GB. With `--query`, the day becomes the span Athena counts.

## Add your own questions

The `rainlytics` executable has a command for each question the package ships. A site's own
rollups, such as `conversionsOf("purchase")`, reach it only through `saved-query`, which runs an
Athena query. A role limited to reading summaries cannot start one.

`@kensio/rainlytics/cli` exports the command line. Run it with your own rollups added to the
shipped commands:

```typescript
import {
  rainlyticsCommands,
  rollupCommand,
  runCli,
} from "@kensio/rainlytics/cli";

import { questions } from "./questions.js";

const shipped = new Set(rainlyticsCommands.map((command) => command.name));

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  commands: [
    ...rainlyticsCommands,
    ...questions
      .filter((rollup) => !shipped.has(rollup.name))
      .map(rollupCommand),
  ],
  io: {
    out: (text) => process.stdout.write(text),
    error: (text) => process.stderr.write(text),
    outIsTerminal: process.stdout.isTTY,
  },
});
```

`rollupCommand` builds the same command the shipped questions get. It reads stored summaries, takes
the same options and refusals, and runs Athena with `--query`. Pass the same rollups given to
`RollupSummaries`.

A site can write a `Command` of its own as well. `run` receives the arguments, the parsed options
and the two streams, and returns columns and rows. Throw `UsageError` for a mistake in what was
typed, and the command exits with code 2.

## Read a calendar report

`report` reads one stored report for a closed calendar period:

```bash
rainlytics report day 2026-08-30
rainlytics report week 2026-08-24 --time-zone Europe/London
rainlytics report month 2026-07 --compare
rainlytics report year 2025
```

The time zone and first weekday must match the `RollupSummaries` deployment. Defaults are UTC and
Monday. `--compare` reads the preceding period too and calculates the changes between both stored
reports. Report commands never run Athena.

Reports always use JSON because their period, source coverage and section metadata are part of the
answer.

## Fill in missed summaries

`backfill` computes the stored summaries of one question over a range of closed windows. Use it
after scheduled runs failed and left windows unwritten:

```bash
rainlytics backfill pageviews hourly --from 2026-09-11 --until 2026-10-12
```

It invokes the deployment's summary function, which runs Athena and writes the summaries. This is
the one command that writes. See [Backfill missed windows](../summary-schedule/#backfill-missed-windows)
for the reports step that follows it.

## Run saved SQL

`RollupQueries` stores generated SQL in Athena. Run a saved query by name:

```bash
rainlytics saved-query countries
```

The `rainlytics-` prefix is optional. `countries` and `rainlytics-countries` select the same saved
query.

A saved query already contains its range, row limit and filters. It accepts `--region`,
`--workgroup` and output options, but it does not accept named-rollup filters such as `--last`,
`--path` or `--country`.

Use `rainlytics query` for SQL written at the terminal. See [Query](../query/).

## Output formats

Named questions, saved queries and ad-hoc queries support JSON, CSV and tables.

```bash
rainlytics pageviews --last 7d --output table
rainlytics pageviews --last 7d --output json
rainlytics pageviews --last 7d --output csv > pageviews.csv
```

Without `--output`, a terminal receives a table and a pipe receives JSON:

```bash
rainlytics pageviews --last 7d | jq '.[0].path'
```

JSON output is an array of row objects. CSV follows RFC 4180 apart from using LF line endings. Table
output contains no color codes or trailing spaces.

Import CSV into spreadsheet software with every external-text column set to text. Referrers and
user agents come from requests, and a value beginning with `=`, `+`, `-` or `@` can be treated as a
formula when a CSV file is opened directly.

## Output streams and exit codes

Data goes to standard output. Help, warnings, source coverage and query cost go to standard error.
Standard output stays empty when a command fails.

| Exit code | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `0`       | The command completed.                                          |
| `1`       | AWS or the requested operation failed. A retry may succeed.     |
| `2`       | The command line was invalid. The same command will fail again. |

Put the command before its options:

```bash
rainlytics pageviews --output csv
```

Run `rainlytics <command> --help` for the full option list and examples for one command.

## Permissions

Reading named questions and reports needs `s3:GetObject` on the summaries bucket. A normal AWS
read-only role often has this access.

`backfill` needs `scheduler:GetSchedule` on the question's schedule and `lambda:InvokeFunction`
on the summary function.

Athena operations need query access to the workgroup, Glue catalog reads, raw log reads and writes
to the query results bucket. Grant the set with `workgroup.grantQuerying(role, table)`. See [Query
workgroup](../query-workgroup/#grant-query-access).

<!-- card
```bash
rainlytics pageviews --last 7d
```
-->
