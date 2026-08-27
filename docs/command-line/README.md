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

Five commands. Four of them answer a named question, and [`query`](../query/) takes SQL for
everything else. The rest of this page is what all of them share.

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

## A command comes before its options

```bash
rainlytics <command> --output csv     # this way round
rainlytics --output csv <command>     # refused, with that sentence
```

`rainlytics --help` and `rainlytics --version` are the only lines with no command in them.

## What it can do today

Answer four named questions, with [`rainlytics pageviews`, `referrers`, `status-codes` and
`cache-hit-ratio`](../rollups/), and run SQL for anything else with
[`rainlytics query`](../query/).

Every one of them reads Athena today. When the scheduled rollups land, the four named ones read a
precomputed summary off S3 instead and each answer costs a GET. The commands and their options stay
where they are, so that swap is invisible from out here.

Rainlytics is experimental and pre-1.0. The command surface will change without a major version
behind it.

<!-- card
```bash
npx @kensio/rainlytics --help
```
-->
