# Rollups

Four questions the command line answers without anybody writing SQL.

```bash
rainlytics pageviews --last 7d
```

```text
path         views
-----------  -----
/              412
/liju/         208
/grammar/       97
```

`referrers`, `status-codes` and `cache-hit-ratio` are the other three. Each takes the same
`--last`, the same `--path` and `--host`, the same output formats and the same bot filter, and each
reports what it scanned and what that cost on standard error.

## What each one counts

**`pageviews`** counts the pages people looked at. A pageview is a GET that answered HTML and
succeeded, which is what separates a page from the images, stylesheets and fonts the same log
records. A 304 counts, because a browser being told its copy is current is somebody looking at the
page. The path is decoded, for the reason under [The log is percent-encoded
twice](#the-log-is-percent-encoded-twice) below.

**`referrers`** counts where people arrived from, by host. Requests carrying no referrer are left
out, and so are the ones this site sent itself. Those are somebody moving around inside it. On the
reference site an unfiltered version of this is topped by its own stylesheet.

**`status-codes`** counts every response, including the assets the pageview count leaves out. A
stylesheet returning 404 is worth seeing and a rollup looking only at pages never would.

**`cache-hit-ratio`** counts over the requests the cache had a say in, being a Hit, a RefreshHit or
a Miss. A redirect, an error and a response a CloudFront Function generated are requests the cache
was never asked about, and counting them would move the ratio without the cache having changed.

## The log is percent-encoded twice

CloudFront percent-encodes every value it writes into a log record, and a request URI reaches it
already carrying the browser's own encoding. A page at `/words/好/` is requested as
`/words/%E5%A5%BD/` and recorded as `/words/%25E5%25A5%25BD/`.

`pageviews` decodes the path twice, so it reports the address a reader would recognise. One pass
answers `/words/%E5%A5%BD/`. That is the URI the browser sent, and it reads no better than the
record. A site whose addresses are all ASCII sees the same table either way.

Only `pageviews` reads a column carrying the encoding. `referrers` reads a referrer for its host,
and a host is ASCII whatever the rest of the URL holds. A status code and a result type arrive
plain. The crawler filter matches ASCII substrings of a user agent and reads an encoded one the
same way.

Two limits are worth knowing. `url_decode` reads `+` as a space. That is right for a query string
and wrong for a path, where `+` is a literal. Athena also raises over an escape naming no byte,
such as `%zz`. A path carrying one that still answered HTML would fail the query outright. Both
stayed theoretical across 137,000 records of real traffic.

## Crawlers are most of the traffic

Every rollup leaves automated traffic out by default. That is a judgement, and here it is.

One hour of the reference site in August 2026 held 9,492 requests. 3,748 of them matched the bot
filter, and 1,951 were a single crawler. Bots were 39% of the hour and the largest single user agent
on the site. An unfiltered pageview count is not the raw number with the opinions taken out. It is a
number that says more about crawlers than about anybody who reads the site.

The filter matches four substrings against a lowercased `cs(User-Agent)`:

```text
bot|crawl|spider|slurp
```

Substrings, because a crawler names itself `ClaudeBot/1.0` with the token glued to a word, which
a whole-word match would walk past. The cost is a device whose name happens to contain one, and the
Cubot range of Android phones is the example. Count it both ways to see how much of the difference is yours:

```bash
rainlytics pageviews --last 7d --include-bots
```

`status-codes` is the one where `--include-bots` is usually what you want. Bots find the broken
links first and in numbers.

## `--path` and `--host` narrow the question

`--path` counts one section of a site, as a prefix of the address:

```bash
rainlytics pageviews --path /guides/ --last 30d
```

It matches the address a reader sees. The record holds it percent-encoded twice, and the filter
decodes before comparing, so `--path /词典/` finds the pages `pageviews` prints under that name. The
text is taken literally. A path holding `_` or `%` matches itself.

`--host` counts one of the sites a single distribution serves:

```bash
rainlytics status-codes --host docs.example.com --last 7d
```

That one matches in full. A site and its `www` name are two hosts, and folding them together is a
decision for whoever runs them rather than a default. `x-host-header` is in the delivered field set
for exactly this, and nothing else in a record says which site was asked for.

Neither option changes what a query costs. `--last` has already decided which partitions are read,
and these two narrow rows that are paid for either way. Narrowing to one section of a busy site
gives a shorter answer for the same money.

## `--last` decides what the question costs

A range becomes partition predicates rather than a filter on the record's own timestamp. `--last 7d`
over a year of logs reads seven days of objects. The same range written `WHERE timestamp_ms > ...`
answers identically and reads the year to do it, which is the mistake the whole partition layout
exists to prevent.

```bash
rainlytics pageviews --last 24h
rainlytics referrers --last 2w
rainlytics status-codes --last 4w --include-bots
```

Whole hours, days or weeks. There is no month, because a month is not a fixed length and a range
that quietly meant thirty days would be worse than one nobody could ask for.

The predicate a range builds names each partition key separately:

```sql
WHERE year IN ('2026')
  AND month IN ('08', '09')
  AND day IN ('28', '29', '30', '31', '01', '02', '03')
  AND cast(timestamp_ms AS bigint) BETWEEN 1787875200000 AND 1788436800000
```

Those are a cross product. A week spanning a month boundary asks for seven days in two months and
reads fourteen partitions, and the timestamp condition after them is what keeps the answer exact. The
alternative is one predicate per day joined by `OR`, which reads exactly the seven and which Athena
plans more slowly the longer the range gets. Fourteen partitions against a year of them is still the
difference the layout exists to make.

## The same SQL, saved in the console

The `RollupQueries` construct saves each rollup as an Athena named query, written by the same builder
the command writes with:

```typescript
import { RollupQueries } from "@kensio/rainlytics/cdk";

new RollupQueries(this, "RainlyticsRollups", { table, workgroup });
```

Somebody in the console can then read what `rainlytics pageviews` counts, run it, and edit it into a
question of their own without reading this repository.

The saved copies cover the current month. There is no span to compute at deploy time, and dates
baked in then would be the dates of whoever last deployed and would change the template on every
deploy. They ask Athena what month it is:

```sql
WHERE year = date_format(current_date, '%Y')
  AND month = date_format(current_date, '%m')
```

## Writing a rollup of your own

The four are assembled from parts the package exports, and a site with a question of its own
assembles a fifth the same way. A rollup is a name, some help text and a function that writes the
SQL for one request:

```typescript
import {
  lastRange,
  qualifiedTableName,
  type Rollup,
  rollupRequest,
  rollupSql,
  rowsFor,
} from "@kensio/rainlytics";

const searches: Rollup = {
  name: "searches",
  summary: "Count what readers searched for.",
  description: "Counts the queries readers typed, most typed first.",
  isRanked: true,
  body: (request) =>
    [
      "SELECT cs_uri_query AS query, count(*) AS searches",
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, ["cs_uri_stem = '/search/'"]),
      "  GROUP BY 1",
      "  ORDER BY 2 DESC, 1",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};

const sql = rollupSql(
  searches,
  rollupRequest({ range: lastRange("7d", new Date()) }),
);
```

`rowsFor` writes the whole `WHERE` clause. The partition predicate, the timestamp bounds, the
crawler filter and the `host` and `path` the request narrowed to all come out of it, and its second
argument carries the conditions this one question adds. Writing that by hand puts a second copy of
[what a range costs](#--last-decides-what-the-question-costs) and of [the crawler
filter](#crawlers-are-most-of-the-traffic) in the site's own repository, and the copy is the one
that goes stale.

`rollupSql` hands back the text. Running it is the site's own Athena client. The `rainlytics`
command reads the four it ships and has no way to load a question from outside the package.

The construct saves a site's rollup in the console beside the built-in four:

```typescript
import { rollups } from "@kensio/rainlytics";
import { RollupQueries } from "@kensio/rainlytics/cdk";

new RollupQueries(this, "RainlyticsRollups", {
  table,
  workgroup,
  rollups: [...rollups, searches],
});
```

The saved copy covers the current month, as the four do. Its description says what it counts and
stops there, since there is no `rainlytics searches` to point a reader at.

A name is lowercase words joined by hyphens (`cache-hit-ratio`). It becomes a CDK logical id and an
Athena query name, and `assertRollupName` refuses anything else at synthesis.

## Output, and what happens next

`--output json`, `csv` or `table`, defaulting to a table at a terminal and to JSON when piped. Every
value is a string, since every column in the log table is one.

```bash
rainlytics pageviews --last 7d --output csv > pages.csv
rainlytics referrers --last 7d | jq '.[0].referrer'
```

`--limit` takes the top rows of a ranked rollup, twenty by default. `cache-hit-ratio` answers with
one row and has nothing to limit.

Each of these reads Athena today, at the cost the [query](../query/) page describes. When the
scheduled rollups land, the same four commands will read a precomputed summary off S3 and each
answer will cost a GET. The commands and their options stay where they are, so that swap is
invisible from out here.

## Anything else

[`rainlytics query`](../query/) takes SQL. These four are the questions worth a name, and the log
table holds a great many more.

<!-- card
```bash
rainlytics pageviews --last 7d
rainlytics referrers --last 7d
rainlytics status-codes --last 7d --include-bots
rainlytics cache-hit-ratio --last 7d
```
-->
