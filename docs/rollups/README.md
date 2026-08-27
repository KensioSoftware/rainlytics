# Rollups

Four questions the command line answers without anybody writing SQL.

```bash
rainlytics pageviews --last 7d
```

```
path         views
-----------  -----
/              412
/liju/         208
/grammar/       97
```

`referrers`, `status-codes` and `cache-hit-ratio` are the other three. Each takes the same
`--last`, the same output formats and the same bot filter, and each reports what it scanned and
what that cost on standard error.

## What each one counts

**`pageviews`** counts the pages people looked at. A pageview is a GET that answered HTML and
succeeded, which is what separates a page from the images, stylesheets and fonts the same log
records. A 304 counts, because a browser being told its copy is current is somebody looking at the
page.

**`referrers`** counts where people arrived from, by host. Requests carrying no referrer are left
out, and so are the ones this site sent itself. Those are somebody moving around inside it. On the
reference site an unfiltered version of this is topped by its own stylesheet.

**`status-codes`** counts every response, including the assets the pageview count leaves out. A
stylesheet returning 404 is worth seeing and a rollup looking only at pages never would.

**`cache-hit-ratio`** counts over the requests the cache had a say in, being a Hit, a RefreshHit or
a Miss. A redirect, an error and a response a CloudFront Function generated are requests the cache
was never asked about, and counting them would move the ratio without the cache having changed.

## Crawlers are most of the traffic

Every rollup leaves automated traffic out by default. That is a judgement, and here it is.

One hour of the reference site in August 2026 held 9,492 requests. 3,748 of them matched the bot
filter, and 1,951 were a single crawler. Bots were 39% of the hour and the largest single user agent
on the site. An unfiltered pageview count is not the raw number with the opinions taken out. It is a
number that says more about crawlers than about anybody who reads the site.

The filter matches four substrings against a lowercased `cs(User-Agent)`:

```
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
