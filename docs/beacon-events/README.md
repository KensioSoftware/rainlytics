# Beacon events

The `beaconEvents` rollup counts browser events by page and event name.

```typescript
import { beaconEvents, defaultBeaconPath, rollups } from "@kensio/rainlytics";

const questions = [...rollups, beaconEvents];
const requests = {
  "beacon-events": { paths: [defaultBeaconPath] },
};

new RollupQueries(this, "SavedQueries", {
  table,
  workgroup,
  rollups: questions,
  requests,
});

new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: questions,
  requests,
});
```

Run the saved query for a fresh answer:

```bash
rainlytics saved-query beacon-events
```

```text
page        event    events
----------  -------  ------
/articles/  route       412
/checkout/  signup       38
```

The page comes from the event's `page` field. The HTTP request itself goes to the collection path.

## Opt in

Beacon events are an optional rollup. An access-log-only deployment produces no event rows and
avoids the empty scheduled queries.

Adding the rollup under both default granularities and two-window recomputation adds 50 Athena
queries a day. At Athena's minimum scan and standard rate, this is about eight cents a month before
traffic raises the scan above the minimum.

The request must name the collection path. If `BeaconPath` uses `/_measure`, use the same path in
`requests`.

## Repeated-event cap

The collection path is open and unauthenticated. `beaconEvents` counts one visitor's identical
events at most 60 times an hour. The key contains the visitor, page, event name and log hour.

The limit applies separately to each visitor, page, event name and hour. A client can bypass it
by changing its address, user agent, page or event name.

The cap requires the viewer address and user agent from the access log. A delivery using
`logFieldNamesWithoutAddress` cannot schedule `beaconEvents`. Rainlytics rejects that combination
during synthesis.

The query uses addresses and user agents internally. Summaries contain only the final counts.

## Write a custom beacon rollup

Use the exported SQL helpers to define a custom rollup over beacon events. This example counts
purchases and sums their values by page:

```typescript
import {
  aBeaconEvent,
  beaconEventColumn,
  beaconEventsJoin,
  beaconPageColumn,
  beaconValueColumn,
  onBeaconPath,
  qualifiedTableName,
  type Rollup,
  rowsFor,
} from "@kensio/rainlytics";

export const takings: Rollup = {
  name: "takings",
  summary: "Total what purchases were worth, by page.",
  description: "Adds up the value every purchase event carried.",
  isRanked: true,
  totals: { added: ["purchases", "pennies"] },
  body: (request) =>
    [
      `SELECT ${beaconPageColumn} AS page,`,
      "  count(*) AS purchases,",
      `  sum(CAST(${beaconValueColumn} AS bigint)) AS pennies`,
      `  FROM ${qualifiedTableName(request.dataset)}`,
      beaconEventsJoin(),
      rowsFor(onBeaconPath(request), [
        ...aBeaconEvent,
        `${beaconEventColumn} = 'purchase'`,
      ]),
      "  GROUP BY 1",
      "  ORDER BY 3 DESC",
    ].join("\n"),
};
```

Add `beaconEventsJoin()` after the table in the `FROM` clause. It expands each log record into
one row per event and supports both beacon protocol versions. Every beacon field expression
reads from this join. Omitting it produces a `COLUMN_NOT_FOUND` error.

`rowsFor` applies the request's partition, timestamp, bot, host and path filters. `onBeaconPath`
supplies the default collection path when no path was specified. `aBeaconEvent` requires a GET
request with a query string, a version and a nonempty event name.

`beaconValueColumn` returns text, including an empty string when an event has no value. Filter
to the events you need and cast values before arithmetic. For money, use consistent integer
minor units as described in [Browser beacon](../beacon/#send-numbers-as-integer-minor-units).

Add the rollup to `RollupSummaries` and save it with `RollupQueries`, as in the first example.
Run it with `rainlytics saved-query takings`. Custom rollups must implement any repeated-event
cap they need. This example has none.

## Raw events remain available

The cap changes the query result, not the raw log. Every request remains in S3 until the log bucket
expires it. Use ad-hoc SQL to inspect the full request count:

```sql
SELECT count(*)
FROM rainlytics.cloudfront_logs
WHERE year = '2026' AND month = '09' AND day = '01'
  AND cs_uri_stem = '/_rainlytics'
```

See [Collection-path abuse](../abuse/) for request costs and limits.

<!-- card
```bash
rainlytics saved-query beacon-events
```
-->
