# Command line

The `rainlytics` command reads analytics from your AWS account.

```bash
pnpm exec rainlytics --help
```

You can also run the package without installing it in a project:

```bash
npx @kensio/rainlytics --help
```

Rainlytics has no account, password or API key of its own.

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

This produces a fresh result and incurs Athena query cost. Rainlytics never falls back to Athena
automatically when a stored summary is missing.

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

## Run saved SQL

`RollupQueries` stores generated SQL in Athena. Run a saved query by name:

```bash
rainlytics saved-query countries
```

The `rainlytics-` prefix is optional. `countries` and `rainlytics-countries` select the same saved
query.

A saved query already contains its range, row limit and filters. It accepts `--region`,
`--workgroup` and output options, but it does not accept named-rollup filters such as `--last` or
`--path`.

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

Athena operations need query access to the workgroup, Glue catalog reads, raw log reads and writes
to the query results bucket. Grant the set with `workgroup.grantQuerying(role, table)`. See [Query
workgroup](../query-workgroup/#grant-query-access).

<!-- card
```bash
rainlytics pageviews --last 7d
```
-->
