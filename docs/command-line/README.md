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

Seven commands. Five of them answer a named question, [`saved-query`](#running-a-query-saved-in-the-workgroup)
runs a question a site saved for itself, and [`query`](../query/) takes SQL for everything else. The
rest of this page is what all of them share.

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

## Region

Every command that reaches Athena takes `--region`, alongside `--database` and `--workgroup`:

```bash
rainlytics pageviews --last 30d --region us-east-1
```

Left off, the region comes from the same chain the credentials do. It reads `AWS_REGION`, then the
region set on the profile, then the instance metadata on EC2. That is the right answer on a machine
set up for one account in one region, and the wrong one on a profile pointing where the analytics
stack never went.

The region decides more than a default suggests. A workgroup, a Glue table and an S3 bucket each
exist in one region, and a query asked in another is answered `WorkGroup rainlytics is not found.`
about a workgroup sitting where it was deployed. Rainlytics adds the region it asked in to that
message. The [query](../query/) page has the whole failure, and why the region to ask is the one the
log bucket is in.

## Where an answer comes from

The five named questions read a precomputed summary off S3. A schedule counted the window once, the
command fetches the windows the range covers, and the whole read costs a GET each. `query` and
`saved-query` run Athena, because ad-hoc SQL has no summary to read.

```bash
rainlytics pageviews --last 7d --summaries rainlytics-summaries-1a2b
```

`--summaries` names the bucket the [summary schedule](../summary-schedule/) writes to.
`RAINLYTICS_SUMMARY_BUCKET` in the environment says it once for a whole shell, and it is the same
variable `RollupSummaries` sets on its own job. With neither, the command says where to put it and
stops.

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

`--output` takes `json`, `csv` or `table`, and every command accepts it.

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

Answer five named questions, with [`rainlytics pageviews`, `referrers`, `status-codes`,
`cache-hit-ratio` and `searches`](../rollups/). Run a question a site saved for itself with
[`rainlytics saved-query`](#running-a-query-saved-in-the-workgroup). Run SQL for anything else with
[`rainlytics query`](../query/).

The five named questions read a [precomputed summary](../summaries/) off S3 and each answer costs a
GET. `query` and `saved-query` reach Athena, and so does a named question given `--query`. The
commands and their options are where M2 left them, which is what makes the swap invisible from out
here.

Rainlytics is experimental and pre-1.0. The command surface will change without a major version
behind it.

<!-- card
```bash
npx @kensio/rainlytics --help
```
-->
