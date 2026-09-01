# Command line

`rainlytics` is how the data collected in your own AWS account is read back. There is no dashboard,
and this page explains why.

```bash
npx @kensio/rainlytics --help
```

That runs on a machine with only Node on it. `aws-cdk-lib` and `constructs` are optional peer
dependencies of this package, and an install that only wants the command line skips both.

`--help` on the root command and on every subcommand is the documentation. A reader should find
everything there, and this page repeats it for people reading the site.

The named questions read one rollup at a time. [`report`](#reading-a-calendar-report) reads a
versioned document containing several sections for one closed calendar period.
[`saved-query`](#running-a-query-saved-in-the-workgroup) runs a question a site saved for itself,
and [`query`](../query/) takes SQL for everything else.

## Why a command line

Authentication, mostly. A dashboard needs an identity story, a session model and a way to revoke
access, and that subsystem then has to stay secure for as long as it exists. A command line on the
AWS SDK's default credential chain inherits SSO, MFA, role assumption, least-privilege IAM policies
and CloudTrail audit of who queried what, and none of that is code in this repository. For a product
whose premise is that it runs in your own AWS account, your existing AWS setup is the coherent
answer.

Structured output is the second reason. A person at a terminal and an assistant with shell access
run the same commands and read the same structured answer, with no API to build in between.

## Authentication

There is no Rainlytics account, password or API key. Credentials come from the AWS SDK's default
chain, which is the same one the AWS CLI reads:

- An SSO session from `aws sso login`.
- A named profile in `AWS_PROFILE`, or the default profile in `~/.aws/credentials`.
- `AWS_ACCESS_KEY_ID` and friends in the environment.
- A role assumed through `AWS_ROLE_ARN`, including the one a CI runner is given.
- The credentials of the EC2 instance, the container or the Lambda it is running in.

Whatever that chain resolves to is what the queries run as, and CloudTrail records them under that
identity.

## Permissions

The identity that chain resolves to needs the permissions for what the command does, and the two
halves of the command surface need different ones.

A named question or calendar report reads a precomputed object. That takes `s3:GetObject` on the
summaries bucket, which an SSO read-only role already carries.

`query`, `saved-query` and `--query` run Athena, which takes four more. Those are
`athena:StartQueryExecution` and `athena:StopQueryExecution` on the workgroup, and `s3:PutObject`
and `s3:AbortMultipartUpload` on the bucket that workgroup writes results to. A read-only role has
none of the four, and a command refused for want of them says so:

```text
rainlytics: User: arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_ReadOnly/... is not
authorized to perform: athena:StartQueryExecution on resource:
arn:aws:athena:eu-west-1:000000000000:workgroup/rainlytics
Running a query takes athena:StartQueryExecution and athena:StopQueryExecution on the rainlytics
workgroup, and s3:PutObject and s3:AbortMultipartUpload on the bucket that workgroup writes results
to. A named question (pageviews, referrers, browsers, status-codes, cache-hit-ratio or searches)
answers from a precomputed summary on s3:GetObject alone. Name the bucket holding those with
--summaries, or put it in RAINLYTICS_SUMMARY_BUCKET.
```

The [query workgroup](../query-workgroup/) page has the whole policy, including the reads a
read-only role already allows.

## Region

Every command that reaches AWS takes `--region`:

```bash
rainlytics pageviews --last 30d --region us-east-1
```

Left off, the region comes from the same chain as the credentials. It reads `AWS_REGION`, then the
region set on the profile, then the instance metadata on EC2. Athena commands also take `--database`
and `--workgroup`.

The region decides more than a default suggests. A workgroup, a Glue table and an S3 bucket each
exist in one region, and a query asked in another is answered `WorkGroup rainlytics is not found.`
about a workgroup sitting where it was deployed. Rainlytics adds the region it asked in to that
message. The [query](../query/) page has the whole failure, and why the region to ask is the one the
log bucket is in.

## Where an answer comes from

The named questions read precomputed summaries off S3. A schedule counted each window once, the
command fetches the windows the range covers, and the whole read costs a GET each. `report` reads one
precomputed report document from the same bucket. `query` and `saved-query` run Athena because
ad-hoc SQL has no stored answer.

```bash
rainlytics pageviews --last 7d --summaries rainlytics-summaries-1a2b
```

`--summaries` names the bucket the [summary schedule](../summary-schedule/) writes to.
`RAINLYTICS_SUMMARY_BUCKET` in the environment says it once for a whole shell, and it is the same
variable `RollupSummaries` sets on its own job. With neither, the command says where to put it and
stops.

The [summary schedule](../summary-schedule/#give-the-command-line-the-generated-bucket-name) page
shows how to publish a generated bucket name through a CloudFormation output and have `cdk deploy`
write it to a local JSON file. Shell setup can read `RAINLYTICS_SUMMARY_BUCKET` from that file. The
command still needs only `s3:GetObject` and avoids a CloudFormation lookup on every run.

`--query` runs the question through Athena:

```bash
rainlytics pageviews --last 7d --query
```

That answer is fresher than the last scheduled run, and it covers windows no schedule has computed.
Athena charges per byte scanned and the command says what it came to. Nothing reaches for it on its
own. A command that queried whenever a summary was missing would put that charge back without
anybody choosing it.

The rows are the same either way, and a pipeline reading the JSON sees no difference. What changes is
on standard error:

```text
Read 23 summaries of pageviews from rainlytics-summaries-1a2b, covering
2026-08-21T15:00:00.000Z to 2026-08-28T14:00:00.000Z.
The newest was computed 2026-08-28T14:15:03.001Z (13 minutes ago). 23 GETs,
about $0.0000092 at the us-east-1 rate.
```

The span there is the one that answered, and it runs a little short of the one asked for. The hour
running now is still filling and has no stored window. Where the range reaches further back than the
schedule does, a further line says how many windows had no summary.

[Rollups](../rollups/#reading-a-precomputed-answer) has which filters a stored summary can answer
under, and [rollup summaries](../summaries/#reading-one-back) has what happens to a range no stored
window covers.

## Output

`--output` takes `json`, `csv` or `table` for commands that answer with rows.

Left off, it is `table` when standard output is a terminal and `json` when standard output is piped
or redirected. That is what makes a pipeline work as typed:

```bash
rainlytics <command>                          # a table, for reading
rainlytics <command> | jq '.[0]'              # JSON, with no flag passed
rainlytics <command> --output csv > views.csv # or ask for something else
```

**JSON** is an array of objects, one per row, with no envelope around it. Every object carries every
column, and a value the row left empty is `null`. So `.[0].path` is the expression, and a key stays
put all the way down the array.

**CSV** follows RFC 4180, with a header line even for a result of zero rows. A field carrying a
comma, a quotation mark or a newline is quoted, and a quotation mark inside one is doubled. Lines
end in LF where the RFC asks for CRLF, because everything that reads a CSV takes LF and the tools in
between mind a stray CR.

**Table** pads each column to its widest value, rules the heading off, and adds no colour and no
trailing whitespace.

`report` has JSON output only because its period, schema version, source coverage and section
metadata are part of the result. It writes the same JSON document at a terminal and in a pipe.
Passing `--output csv` or `--output table` is a usage error.

### CSV in a spreadsheet

Referrers and user agents are written by whoever made the request. Excel and LibreOffice treat a
field opening with `=`, `+`, `-` or `@` as a formula, so a crafted referrer can become one when the
file is double-clicked.

Rainlytics writes the value exactly as it read it, because the same file is what a script
downstream parses. Where the data is going anywhere near a spreadsheet, import the file rather than
double-clicking it, and choose text for those columns.

## Streams and exit codes

The result of a command goes to standard output. Everything else, including help, warnings and the
reason for a failure, goes to standard error. A pipeline therefore reads data and never prose.

| Exit | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | It worked.                                                          |
| 1    | The command ran and could not finish. A retry sometimes gets past.  |
| 2    | The command line was wrong. Running it again unchanged fails again. |

Two failure codes because they call for different responses, and 2 for a usage error is the
convention `getopt` set and Python's `argparse` kept.

Standard output stays empty on both. Nothing that failed writes a partial result that a later step
could mistake for a whole one.

## Reading a calendar report

`rainlytics report` reads one closed day, week, month or year from the summaries bucket:

```bash
rainlytics report day 2026-08-30
rainlytics report week 2026-08-24 --time-zone Europe/London
rainlytics report month 2026-07 --compare
rainlytics report year 2025
```

The date selects the period. A weekly date can be any date inside the week. `--time-zone` defaults
to UTC and `--week-starts-on` defaults to Monday. Both must match the values passed to
`RollupSummaries`, since those values are part of a report's S3 address. The command derives the
key from them.

`--summaries` names the bucket, and `RAINLYTICS_SUMMARY_BUCKET` supplies the same default used by
the named questions. `--region` uses the AWS SDK credential and region chain when left off.

The versioned report document is the whole of standard output. Standard error names the bucket and
object key, the object's last-modified age and the price of one S3 GET. A missing, incomplete or
unsupported document exits non-zero with empty standard output. Reading a report never starts an
Athena query.

`--compare` derives changes against the immediately preceding calendar period. It reads the earlier
stored report with one additional S3 GET and writes a versioned comparison document. Both report
periods, computation times and source coverage values stay in the result. Standard error names both
object keys and the price of two GETs. The [calendar reports](../reports/#comparing-adjacent-periods)
page defines the metric and missing-data rules.

## Running a query saved in the workgroup

`rainlytics saved-query` runs a query Athena already holds, by name:

```bash
rainlytics saved-query countries
```

The [`RollupQueries`](../rollups/#the-same-sql-saved-in-the-console) construct saves one named query
per rollup, and a site that [wrote a rollup of its own](../rollups/#writing-a-rollup-of-your-own)
saves that beside them. That is how a question this package never shipped gets a command line, with
the `--output` formats, the cost report and the exit codes every other command has.

The name is the one Athena lists, with or without the `rainlytics-` prefix the construct adds.
`countries` and `rainlytics-countries` reach the same saved query. A name matching nothing is
answered with the names that are saved in the workgroup. A guess is one way to find out what is
there.

What a saved query covers was settled when it was saved. `--last`, `--limit`, `--include-bots`,
`--path`, `--host` and `--param` are absent here, and each is refused rather than accepted and
ignored. The SQL Athena holds carries a range and a row count already, and a saved rollup covers the
month you run it in. `requests` on the construct is where the rest of it is decided.

The database comes from the saved query too. Athena records the one a query was written against, and
this runs it against that one. `--workgroup` and `--region` say where to look, and the query runs
where it was found.

## A command comes before its options

```bash
rainlytics <command> --output csv     # this way round
rainlytics --output csv <command>     # refused, with that sentence
```

`rainlytics --help` and `rainlytics --version` are the only lines with no command in them.

## What it can do today

Answer the six default questions with [`rainlytics pageviews`, `referrers`, `browsers`,
`status-codes`, `cache-hit-ratio` and `searches`](../rollups/). A deployment using the browser
beacon can add the shipped [`javascript-errors`](../javascript-errors/) and
[`web-vitals`](../web-vitals/) questions. Read a closed day, week, month or year with
[`rainlytics report`](#reading-a-calendar-report).
Run a question a site saved for itself with
[`rainlytics saved-query`](#running-a-query-saved-in-the-workgroup), and run SQL for anything else
with [`rainlytics query`](../query/).

The named questions read [precomputed summaries](../summaries/) off S3. A calendar report is one
precomputed document. `query` and `saved-query` reach Athena, and so does a named question given
`--query`.

Rainlytics is experimental and pre-1.0. The command surface will change without a major version
behind it.

<!-- card
```bash
npx @kensio/rainlytics --help
```
-->
