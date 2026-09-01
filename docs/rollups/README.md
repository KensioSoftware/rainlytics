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

`javascript-errors` and `web-vitals` are optional questions for sites using the browser module.
`beacon-events` is another optional rollup and runs through `saved-query`. Optional questions are
excluded from the defaults because a site without those browser events would pay for empty queries.

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

`RollupQueries` stores one Athena named query per rollup:

```typescript
import { RollupQueries } from "@kensio/rainlytics/cdk";

new RollupQueries(this, "SavedQueries", {
  table,
  workgroup,
  requests: {
    searches: { paths: ["/search/"], param: "q" },
  },
});
```

Saved queries cover the current month. Run one with:

```bash
rainlytics saved-query searches
```

Pass the same `requests` values to `RollupQueries` and `RollupSummaries` so the saved SQL and stored
answers describe the same question.

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

These helpers keep custom questions consistent with the built-in URL decoding and path matching.

<!-- card
```bash
rainlytics pageviews --last 7d
rainlytics status-codes --last 7d --include-bots
```
-->
