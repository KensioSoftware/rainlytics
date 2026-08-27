# Query

`rainlytics query` takes SQL, runs it through the Rainlytics workgroup, and prints the rows.

```bash
rainlytics query "SELECT cs_uri_stem, count(*) AS views
  FROM cloudfront_logs
  WHERE year = '2026' AND month = '08' AND day = '27'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 5"
```

```text
cs_uri_stem      views
---------------  -----
/                  412
/liju/             208
/grammar/           97
/pinyin/            61
/tones/             44
```

The SQL is one argument and has to be quoted. A shell splits an unquoted query on spaces and eats
the quotes inside it, which leaves Athena a different question from the one that was asked. The
command refuses a line that arrived in pieces. Running the first word of one would ask Athena
something else entirely and answer it.

## What it needs

The [log table](../log-table/) and the [query workgroup](../query-workgroup/), both deployed. The
command reads their names from the same exported definition the constructs create them under. A
default deployment needs no flags:

```bash
rainlytics query "SELECT count(*) FROM cloudfront_logs"
```

Pass `--database` or `--workgroup` where either was renamed. This command always names a
workgroup, so a query it runs is always under a cutoff. Athena's `primary` workgroup has no cutoff
at all, and what lands there is a query sent by something else. The console, the AWS CLI, and a
script of your own that left the workgroup out all do.

Credentials and profile come from the AWS SDK's default chain, the same one the AWS CLI reads.
There is nothing Rainlytics-specific to configure.

## The region has to be the one the data is in

The region comes from that chain too. It reads `AWS_REGION` first and then the region on the
profile, and `--region` names one over the top of both:

```bash
rainlytics query "SELECT count(*) FROM cloudfront_logs" --region us-east-1
```

A workgroup, a Glue table and an S3 bucket each exist in one region. Ask a region that holds none of
them and Athena answers about the workgroup, which is the first thing it looks for:

```text
rainlytics: WorkGroup rainlytics is not found. Athena was asked in eu-west-2. Name another with
--region.
```

The first sentence is Athena's, and it names the workgroup it could not find and never says where it
looked. The second is this command adding that. A profile defaulting to a region the deployment
never went near produces exactly this, and so does a workgroup that really was deleted.

Which region to ask is decided by the log bucket. Athena reads a bucket in another region and bills
the transfer for every query, which is why the [log table](../log-table/) belongs in the bucket's
region as well. Log delivery is the one part of Rainlytics that has to be configured from us-east-1.
Where that delivery stack sits is a separate question from where a query runs.

Every command that reaches Athena takes `--region`, `--database` and `--workgroup`, including the
four [named questions](../rollups/).

## Naming a partition is most of what a query costs

Athena bills per byte scanned. The partition keys are `distributionid`, `year`, `month`, `day` and
`hour`, and a predicate on any of them cuts what is read before it is read. A predicate on anything
else narrows the rows afterwards, and the bytes are billed either way.

Here is the difference on a real bucket. Figures read off the Chinese Boost log bucket on
2026-08-27, two days into delivery:

```bash
rainlytics query "SELECT count(*) FROM cloudfront_logs"
```

```text
Scanned 8.12 MB in 1.2s, billed as 10.0 MB (the per-query minimum). About $0.000050 at the
us-east-1 rate.
```

```bash
rainlytics query "SELECT count(*) FROM cloudfront_logs
  WHERE year = '2026' AND month = '08' AND day = '26' AND hour = '14'"
```

```text
Scanned 265 KB in 0.4s, billed as 10.0 MB (the per-query minimum). About $0.000050 at the
us-east-1 rate.
```

580 objects against 13. The second query read a thirtieth of what the first did, and both cost the
same, because Athena bills a ten million byte minimum whatever a query reads.

That is the honest version of this example, and it is worth sitting with. Pruning saves nothing on
a two-day-old dataset. What it changes is the shape of the curve. The hour query goes on reading 265
KB for ever, while the unqualified one grows with the bucket. [#9](https://github.com/KensioSoftware/rainlytics/issues/9)
measured this site levelling off near 1.6 GB under the 365-day expiry, at which point the same pair
reads 1.6 GB against 265 KB and costs $0.0080 against $0.000050.

A rollup that runs every hour for a year is where that difference stops being academic.

## The price is on standard error

Every query reports what it scanned and what that came to:

```text
Query 8d0a2f4c-1a3e-4f77-9d0e-6c2b1f9a4e11 ran in workgroup rainlytics in us-east-1.
Scanned 265 KB in 0.4s, billed as 10.0 MB (the per-query minimum). About $0.000050 at the
us-east-1 rate.
```

It goes to standard error. A pipeline reads rows, and a person still sees the price:

```bash
rainlytics query "SELECT c_country, count(*) FROM cloudfront_logs
  WHERE year = '2026' AND month = '08'
  GROUP BY 1" | jq '.[0]'
```

The dollar figure is an estimate, and the line says which rate it used. It applies the us-east-1
rate of $5.00 per terabyte and the ten million byte minimum, both read from the AWS Pricing API on
2026-08-27, and rounds a scan up to the next megabyte the way the pricing page describes. Every
other region charges its own rate, and the invoice rounds across a month of queries.

A query that failed is priced at nothing, because Athena bills nothing for one. What it read
before giving up is still reported:

```text
Scanned 1.20 GB in 8.4s. Athena does not charge for a query that failed.
```

A query the workgroup stopped is a different case. Athena cancels that one rather than failing it,
and it bills a cancelled query for what it scanned.

## When the workgroup stops a query

The workgroup carries a ceiling. A query that would scan past it is stopped, and the message says
what it read, what the workgroup allows, and the two ways forward:

```text
rainlytics: Bytes scanned limit was exceeded. The query scanned 12884901888 bytes, and
workgroup rainlytics allows 10737418240 per query.
That ceiling is the workgroup's, and it is there so one query cannot run up a bill nobody
chose. Narrow the query by naming distributionid, year, month, day or hour, or raise
bytesScannedCutoff on the rainlytics workgroup if the query really needs to read that much.
```

Athena bills a cancelled query for what it scanned on the way to being stopped, so the ceiling
puts a bound on the cost without removing it. The [query workgroup](../query-workgroup/) page has
where the default comes from and how to move it.

## Output

`--output json`, `csv` or `table`, defaulting to a table at a terminal and to JSON when standard
output is piped or redirected. Every value comes back as a string, because every column in the log
table is a string.

```bash
rainlytics query "SELECT cs_uri_stem FROM cloudfront_logs
  WHERE year = '2026' AND month = '08' AND day = '27'" --output csv > paths.csv
```

A result larger than one page is fetched whole, since Athena hands back a thousand rows at a time
and a truncated answer would look like a complete one. A query whose answer is too big to hold is
one that wanted a `LIMIT`.

## Reading the data

Every column in the table is a string. The casting belongs in the query:

```sql
SELECT
  from_unixtime(cast(timestamp_ms AS bigint) / 1000) AS at,
  cast(sc_status AS integer) AS status,
  nullif(cs_referer, '-') AS referrer,
  url_decode(cs_uri_stem) AS path
FROM cloudfront_logs
WHERE year = '2026' AND month = '08' AND day = '27'
```

CloudFront URL-encodes what it logs and writes `-` for an empty field. The [log
table](../log-table/) page has the full column list and where each name comes from.

## Exit codes

`0` when the query ran, `1` when it ran and could not finish, and `2` when the command line could
not be read. A query Athena refuses exits `1` with its reason on standard error, and a query that
was never sent, such as one whose SQL the shell took apart, exits `2`.

## Permissions

Held by whoever runs the query rather than by the deploy role. The [query
workgroup](../query-workgroup/) page lists them: Athena on the workgroup, Glue on the table and its
catalog, S3 read on the log bucket and S3 read and write on the results bucket.

<!-- card
```bash
rainlytics query "SELECT cs_uri_stem, count(*) AS views
  FROM cloudfront_logs
  WHERE year = '2026' AND month = '08'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 5"
```
-->
