# Rollups

A rollup is a named analytics question. Rainlytics generates its Athena SQL, schedules it and gives
it a command-line name.

```bash
rainlytics pageviews --last 7d
```

## Built-in questions

| Command           | Answer                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `pageviews`       | Successful HTML GET requests by decoded path. A 304 counts as a view. |
| `referrers`       | External referrer hosts. Empty and same-site referrers are omitted.   |
| `browsers`        | Pageviews by browser family and device class.                         |
| `status-codes`    | All site responses by HTTP status, excluding the beacon path.         |
| `cache-hit-ratio` | Hits and misses for requests that reached the cache.                  |
| `searches`        | Search terms and temporary redirects from configured search pages.    |

The exported `rollups` array contains these six questions.

`javascript-errors`, `web-vitals` and `beacon-totals` are optional questions for sites using the
browser module. `beacon-events` is another optional rollup and runs through `saved-query`. Optional
questions are excluded from the defaults because a site without those browser events would pay for
empty queries.

## Total what beacon events measured

`beacon-totals` adds up the number each beacon event carried, grouped by event name:

```typescript
import { beaconTotals, rollups } from "@kensio/rainlytics";

new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: [...rollups, beaconTotals],
});
```

```bash
rainlytics beacon-totals --last 7d
```

```text
event          events  total
-------------  ------  ------
purchase           38  94820
add-to-basket     211  38400
```

Only events carrying a number are read. Web Vitals and JavaScript errors are left out by name, and
a route change is left out because it carries no number. A row whose number cannot be read counts in
`events` and leaves `total` where it was, so a site can see that something sent a value the question
could not use.

Negative values are kept, so a refund reported as a negative amount nets off against the purchases
beside it.

Send money as integer minor units. [The beacon page](../beacon/) has why.

Both columns add across stored windows, so 24 hourly summaries make the day.

### What one visitor can contribute

One visitor contributes no more than 60 events of one name an hour, the way `beacon-events` bounds a
count. The rollup therefore names the viewer's address, and `RollupSummaries` refuses a deployment
whose delivery leaves that field out.

The cap bounds rows and not the value a row carries. A client sending an enormous number a million
times still contributes sixty of them, which is sixty times a number nobody spent. Capping the value
itself would clip a genuinely large purchase, and no number separates the two cases.

So a total over an open collection path is a weaker figure than a count over one. What bounds it
properly is the raw store. Every row is still there, and a site that finds a flood can work out what
it really took over rows the cap threw away. [Abuse](../abuse/) has the rest.

## Filter a question

All named questions support a time range:

```bash
rainlytics pageviews --last 24h
rainlytics referrers --last 2w
```

The suffix can be `h`, `d` or `w`. The range becomes partition predicates, which limit the bytes
Athena reads.

Filter by path prefix or host:

```bash
rainlytics pageviews --path /guides/ --last 30d
rainlytics status-codes --host docs.example.com --last 7d
```

Repeat `--path` to combine several sections. Host matches are exact.

Automated traffic is omitted by default. The filter matches `bot`, `crawl`, `spider` or `slurp` in
the lowercased user agent. Include those requests when they matter to the question:

```bash
rainlytics status-codes --last 7d --include-bots
```

The filter is useful but cannot identify every automated client. Any client controls its own user
agent.

## Read stored or fresh data

Named commands read [rollup summaries](../summaries/) from S3:

```bash
rainlytics pageviews --last 7d --summaries rainlytics-summaries-1a2b
```

The command combines complete hourly and daily windows inside the requested range. The current
partial hour is left out. Standard error reports the exact span used, missing edge windows and the
age of the newest summary.

Add `--query` to calculate one fresh result from raw logs:

```bash
rainlytics pageviews --last 7d --query
```

Stored ranked results are approximate across several windows because each window only kept its own
leading rows. Counts are added and the combined rows are ranked again. A fresh Athena query ranks
the full range in one pass.

Percentiles and visitor identities cannot be combined from summary values. Commands that need the
raw distribution or identity set require a single stored window or `--query` for a larger range.

## Save the generated SQL

`RollupQueries` stores one Athena named query per rollup, over whatever the schedules compute:

```typescript
import { RollupQueries, RollupSummaries } from "@kensio/rainlytics/cdk";

const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  requests: {
    searches: { paths: ["/search/"], param: "q" },
  },
});

new RollupQueries(this, "SavedQueries", { summaries });
```

Saved queries cover the current month. Run one with:

```bash
rainlytics saved-query searches
```

The summaries carry the table, the workgroup, the questions and what each one covers, so a
deployment names all four once. Adding a question to `RollupSummaries` alone used to give it a
schedule and leave the console holding the shipped six, and the deploy reported success.

A deployment with no summaries to read passes a table and a workgroup:

```typescript
new RollupQueries(this, "SavedQueries", {
  table,
  workgroup,
  requests: {
    searches: { paths: ["/search/"], param: "q" },
  },
});
```

Both together are refused at synthesis, since the point of the first shape is that there is one
list.

## Write a custom rollup

A custom rollup supplies a name, help text and a function that builds SQL for one request.

```typescript
import { qualifiedTableName, type Rollup, rowsFor } from "@kensio/rainlytics";

const countries: Rollup = {
  name: "countries",
  summary: "Count pageviews by country.",
  description: "Counts pageviews by viewer country, highest first.",
  isRanked: true,
  totals: { added: ["views"] },
  body: (request) =>
    [
      "SELECT c_country AS country, count(*) AS views",
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, ["sc_content_type LIKE 'text/html%'"]),
      "  GROUP BY 1",
      "  ORDER BY 2 DESC, 1",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};
```

Use `rowsFor` for the `WHERE` clause. It adds the time partitions, timestamp bounds, bot filter,
host filter and path filters from the request.

`totals.added` lists numeric columns that can be added across stored windows. All other columns
identify a row. A rollup with no totals can only answer from one stored window.

Save and schedule the custom question:

```typescript
import { rollups } from "@kensio/rainlytics";

const questions = [...rollups, countries];

new RollupQueries(this, "SavedQueries", {
  table,
  workgroup,
  rollups: questions,
});

new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: questions,
});
```

Run it with `rainlytics saved-query countries`. The fixed CLI command list only contains questions
shipped by the package.

Names use lowercase words joined by hyphens. Each scheduled question must have a unique name because
the name is part of its saved query and S3 key.

## Decode fields in custom rollups

Use `decodedColumn` for a whole logged field and `decodedParameter` for one query-string value.
`matchedPath` returns the path prefix matched by a request when a question covers several sections.

`quoted` writes one value into SQL with every quote in it doubled, and `oneOf` writes a column
holding any of a list. Reach for those rather than building a string literal by hand. That is the
one part of writing SQL worth getting right once.

A question over beacon rows also wants `onBeaconPath`, which fills the collection path in where the
request named none:

```typescript
import { aBeaconEvent, onBeaconPath, oneOf, rowsFor } from "@kensio/rainlytics";

rowsFor(onBeaconPath(request), [
  ...aBeaconEvent,
  oneOf(beaconEventColumn, ["signup", "trial"]),
]);
```

Without it the question counts every request on the site carrying a `v` parameter, and `?v=3` on a
stylesheet is an ordinary thing for a site to serve.

These helpers keep custom questions consistent with the built-in URL decoding and path matching.

<!-- card
```bash
rainlytics pageviews --last 7d
rainlytics status-codes --last 7d --include-bots
```
-->
