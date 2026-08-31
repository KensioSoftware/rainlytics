# Beacon events

Counts what the beacon reported, by the page an event happened on and the name it was reported
under, with a flood of identical events bounded.

```typescript
import { beaconEvents, defaultBeaconPath, rollups } from "@kensio/rainlytics";

const beaconPath = { paths: [defaultBeaconPath] };

new RollupQueries(this, "RainlyticsQueries", {
  table,
  workgroup,
  rollups: [...rollups, beaconEvents],
  requests: { "beacon-events": beaconPath },
});
```

```bash
rainlytics saved-query beacon-events
```

```text
page        event   events
----------  ------  ------
/liju/      route      412
/liju/      vital      408
/grammar/   route       97
```

The page comes out of the query string rather than out of the request, because the request was sent
to the beacon's own path. A route change in a single-page app is what that exists for, where the
address bar has moved and no request was made.

## A site opts into it

The five default questions are computed for every deployment. This one waits to be asked for, so a
site with no beacon leaves it out and computes none of it. Layer 2 is optional, and a scheduled
question over rows nobody writes is an Athena charge per window for an empty answer.

A site running the beacon adds it to both constructs, once to save the query and once to compute it
on a schedule:

```typescript
new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  rollups: [...rollups, beaconEvents],
  requests: { "beacon-events": beaconPath },
});
```

That is 50 more Athena queries a day on the two cadences, which comes to about 8 cents a month.
`rainlytics saved-query beacon-events` runs the saved copy through Athena for a fresh answer, and
the summaries it writes are JSON on S3 in the [shape every summary takes](../summaries/).

## Narrow it to the collection path

`--path` is what separates a beacon event from every other query string in the same log. `?v=3` on a
stylesheet is an ordinary thing for a site to serve, and this question reads a `v` parameter to find
its envelope.

The `requests` entry above is that narrowing for a saved copy and for a schedule. A site that moved
its beacon names its own path there, in the one place, and the [beacon path](../beacon-path/)
construct takes the same value.

## One visitor, sixty events an hour

The collection path is open and unauthenticated by design. Anybody can send its URL a million times
and have every one of them counted, under a page value naming a page nobody opened.

So this question counts one visitor's identical events no more than 60 times an hour. That is one a
minute from one person, on one page, of one event name. A reader who moves around a site produces
events on several pages and is capped on each of them separately. A client sending the same URL a
million times contributes 60.

The hour is the row's own, taken from its timestamp rather than from the window being computed. An
hourly summary and the daily summary covering it therefore apply the same cap, and the 24 hours of a
day add up to the day.

Two rules stack here. The [crawler filter](../rollups/#crawlers-are-most-of-the-traffic) every
question applies has already taken a flood that names itself a bot. The cap is for the quiet
kind.

### Why a cap per visitor

Two other rules were considered, and both fall to what the beacon is for.
[#104](https://github.com/KensioSoftware/rainlytics/issues/104) has them.

**Dropping events whose page never appears as a pageview in the same window.** A route change in a
single-page app has no document request behind it. This rule drops exactly the events layer 2 was
built to collect.

**A cap per path.** A popular page legitimately carries many events. A cap low enough to bound a
flood clips real traffic, and one high enough to spare real traffic lets a flood run underneath it.

A cap per visitor is the one that scales with real popularity. Ten thousand readers count as ten
thousand, and one client counts as one whatever it sends.

### Where it runs out

A client rotating addresses counts as many visitors and gets the cap each time. An access log reads
that as a crowd, and the same limit applies to the [visitor count](../visitors/).

Every spammed request also costs money before any of this runs, and no filter written afterwards
takes it back. [What abuse of the collection path costs](../abuse/) has the three charges and the
budget alarm that is the honest answer to them.

## It needs the viewer's address

A visitor here is the address and the user agent CloudFront logged, which is the pair a [visitor
count](../visitors/) is hashed from. Both values stay inside the query. The inner `SELECT` groups by
them and the outer one adds up what that produced, so no address reaches a summary, a result object
or a reader.

A deployment delivering [`logFieldNamesWithoutAddress`](../log-delivery/#the-field-set-holds-the-viewers-address)
has no column to key the cap on, and `RollupSummaries` refuses the question at synthesis:

```text
beacon-events bounds a flood by capping what one visitor sent, and this deployment's
delivery leaves out c-ip. Either add c-ip to the delivered field set, or leave the
question out of this deployment. Counting beacon events with no cap would report a
flood of a million as a million.
```

The cap has no off switch, which is what separates this from the visitor count. A summary without a
visitor count is the same question with one fewer number beside it. A beacon rollup without the cap
is a different question, and it would report a flood of a million as a million.

## The raw store keeps everything

The cap is applied by the query and changes no object in the bucket. Every request the beacon path
answered is still a row, spammed ones included, and `rainlytics query` counts them all for anybody
checking what arrived:

```sql
SELECT count(*) FROM "rainlytics"."cloudfront_logs"
  WHERE year = '2026' AND month = '08' AND day = '23'
    AND strpos(cs_uri_stem, '/_rainlytics') = 1
```

A rule that turns out to be wrong is a re-run over rows that are all still there. The [log
bucket's](../log-bucket/) expiry is the outer limit on that, and a year is the default.

<!-- card
```text
one visitor, one page, one event name
sixty an hour, whatever arrives
```
-->
