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

The page comes from the event's `p` parameter. The request itself always goes to the collection
path.

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

This cap allows real traffic to grow with the audience while limiting one client that repeats the
same event URL. A client can bypass the cap by rotating addresses, user agents, pages or event
names.

The cap requires the viewer address and user agent from the access log. A delivery using
`logFieldNamesWithoutAddress` cannot schedule `beaconEvents`. Rainlytics rejects that combination
during synthesis.

No address or user agent reaches the summary. The query groups by them internally and writes the
final counts only.

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
