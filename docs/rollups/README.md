# Rollups

A rollup is a named analytics query, such as pageviews grouped by path. Rainlytics runs it in Athena
on a schedule and stores the result in S3. Built-in CLI commands read those stored results:

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

Browser rollups are optional. Add `javascriptErrors`, `webVitals` or `beaconTotals` when your site
collects those events. Each has a matching CLI command. `beaconEvents` and the conversion rollups
are also optional and run through `saved-query`.

`conversionsOfPath` measures conversions from ordinary access-log requests and needs no browser
module. The examples below show how to configure each optional rollup.

## Filter a question

All named questions support a time range:

```bash
rainlytics pageviews --last 24h
rainlytics referrers --last 2w
```

The suffix can be `h`, `d` or `w`. For stored reads, the range selects summary windows. With
`--query`, it becomes time and partition filters that limit the logs Athena reads.

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

Percentiles cannot be combined from summary values. For example, `web-vitals` requires a single
stored window or `--query` for a larger range. Visitor counts also need one calculation over the
whole period. Use [calendar reports](../reports/) for longer visitor counts.

## Save the generated SQL

`RollupQueries` saves SQL in Athena for the rollups configured on `RollupSummaries`:

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

Passing `summaries` reuses its table, workgroup, rollups and request filters. Add or change a rollup
on `RollupSummaries` to update both the scheduled and saved queries.

For a deployment without scheduled summaries, pass a table and workgroup directly:

```typescript
new RollupQueries(this, "SavedQueries", {
  table,
  workgroup,
  requests: {
    searches: { paths: ["/search/"], param: "q" },
  },
});
```

Pass either `summaries` or the individual configuration properties. Combining them fails
synthesis.

## Sum numeric event values

`beacon-totals` sums the `value` field of custom beacon events, grouped by event name:

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

The rollup reads custom events with a nonempty value. It excludes Web Vitals and JavaScript
errors by event name. Events without a value, including normal route changes, are excluded.
An invalid numeric value contributes to `events` but contributes nothing to `total`.

Negative values are included. For example, a negative refund reduces the total of the purchase
events reported under the same name.

For money, use consistent integer minor units. See
[Browser beacon](../beacon/#send-numbers-as-integer-minor-units).

Both columns can be added across stored windows for matching event names. The ranking still has
the stored-row limits described under [Read stored or fresh data](#read-stored-or-fresh-data).

### What one visitor can contribute

One visitor contributes at most 60 events of each name per hour. The query identifies a visitor
by IP address and user agent. `RollupSummaries` rejects this rollup when log delivery omits the
address.

The cap limits the number of events included, but each event can contain an arbitrarily large
value. Sixty fabricated values can still distort a total. A reported amount from this open
endpoint is not proof of a transaction.

Raw events remain available for investigation and recomputation with stricter filters. Use your
transaction records to verify revenue. See [Collection-path abuse](../abuse/) for the limits of
query-time filtering.

## Measure a conversion rate

`conversionsOf(event)` creates a rollup that measures the percentage of page visitors who also
reported that event within the same time window:

```typescript
import { conversionsOf, rollups } from "@kensio/rainlytics";

new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: [...rollups, conversionsOf("purchase")],
});
```

```bash
rainlytics saved-query conversions-purchase
```

```text
converted  visitors  converted_percent
---------  --------  -----------------
       17       842                2.0
```

Call the factory once per event name. For example, `purchase` and `signup` produce separate
rollups, each with its own saved query, schedule and summary key.

`visitors` counts distinct visitors with a pageview in the window. `converted` counts those who
also reported the chosen event. `converted_percent` is their percentage of all page visitors.
An event without a matching pageview in the same window contributes to neither count. The query
checks whether both occurred in the window, without requiring the pageview to occur first.

The query groups visitors by IP address and user agent. These values stay inside the query and
are excluded from the result. The rollup declares `identifiesViewers`, and synthesis fails if the
delivery omits the address.

The request's path filter selects the beacon collection path. Page visitors are counted across
all page paths under the same host and time filters.

### Choose a window that includes the visit

A page view at 09:59 and a purchase at 10:01 fall in separate hourly windows. Neither window
contains both actions. A daily window reduces this problem, although visits can still cross
midnight.

Visitor counts from separate windows cannot be added. Two hours with ten visitors each may contain
the same ten visitors or twenty different ones. Conversion rollups therefore declare no additive
totals. Query the raw logs over the full period when you need a longer conversion window.

### Measure conversions from access logs

Use `conversionsOfPath` when a request to a particular URL represents a conversion. For example,
a successful checkout POST can be counted directly from CloudFront logs:

```typescript
import { conversionsOfPath, rollups } from "@kensio/rainlytics";

new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: [
    ...rollups,
    conversionsOfPath({
      path: "/do/checkout",
      method: "POST",
      statuses: ["303"],
    }),
  ],
});
```

```bash
rainlytics saved-query conversions-do-checkout
```

Both conversion factories return the same three columns and use the same visitor definition.
The window-boundary and aggregation limits apply to both.

Set `method` and `statuses` to select successful requests. Otherwise, a failed checkout can count
as a conversion. Omit these settings only when every request to the path should count.

The path is a prefix. For example, `/do/checkout` also matches `/do/checkout/1a2b`.

The default rollup name is derived from the path. `/do/checkout` becomes `conversions-do-checkout`.
Pass `name` if paths would produce duplicate names or if the path contains no usable name.

## Write a custom rollup

A custom rollup supplies a name, help text and a function that builds SQL for one request.

```typescript
import {
  aPageView,
  qualifiedTableName,
  type Rollup,
  rowsFor,
} from "@kensio/rainlytics";

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
      rowsFor(request, [...aPageView]),
      "  GROUP BY 1",
      "  ORDER BY 2 DESC, 1",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};
```

Use `rowsFor` for the `WHERE` clause. It adds the time partitions, timestamp bounds, bot filter,
host filter and path filters from the request.

`aPageView` contains the built-in pageview conditions (a `GET` with a `text/html` response and
status 200 or 304). Include it to use the same pageview definition as the built-in rollup.

Add conditions beside it to narrow what it counts:

```typescript
import { aPageView, decodedColumn, rowsFor } from "@kensio/rainlytics";

rowsFor(request, [
  ...aPageView,
  `${decodedColumn("cs_uri_stem")} = '/basket/'`,
]);
```

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

`quoted` escapes a SQL string literal by doubling single quotes. `oneOf` builds a condition that
matches any value in a list. Use these helpers when inserting values into generated SQL.

A beacon rollup uses `onBeaconPath` to supply the default collection path when none was specified:

```typescript
import {
  aBeaconEvent,
  beaconEventColumn,
  onBeaconPath,
  oneOf,
  rowsFor,
} from "@kensio/rainlytics";

rowsFor(onBeaconPath(request), [
  ...aBeaconEvent,
  oneOf(beaconEventColumn, ["signup", "trial"]),
]);
```

Keep the collection-path filter even when checking the beacon version and event fields. Other
requests can contain parameters with the same names.

Add `beaconEventsJoin()` after the table in the `FROM` clause to expand each request into event
rows. `beaconEventColumn` and the other beacon field expressions require that join. Omitting it
produces `COLUMN_NOT_FOUND`. See the complete
[custom beacon rollup](../beacon-events/#write-a-custom-beacon-rollup) example.

These helpers keep custom questions consistent with the built-in URL decoding and path matching.

<!-- card
```bash
rainlytics pageviews --last 7d
rainlytics status-codes --last 7d --include-bots
```
-->
