# Web Vitals

`web-vitals` reports the 75th percentile of each Web Vital collected by the browser beacon.

```typescript
import { rollups, webVitals } from "@kensio/rainlytics";
import { RollupSummaries } from "@kensio/rainlytics/cdk";

new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  rollups: [...rollups, webVitals],
});
```

```bash
rainlytics web-vitals --last 2h
```

```text
vital  p75   samples
-----  ----  -------
cls    0.08       42
fcp    912        46
lcp    2180       41
ttfb   164        47
```

LCP, FCP and TTFB are milliseconds. CLS is a unitless score. `samples` is the number of numeric
measurements behind each percentile.

## A site opts into it

The five default rollups work from access-log fields every deployment has. This one reads rows from
the optional browser beacon. A site without those rows would pay for an empty Athena query on every
window, so `webVitals` stays outside the exported `rollups` list.

Adding it on both cadences with the default two-window recomputation makes 50 more Athena queries a
day. At Athena's ten million byte minimum, that comes to about 8 cents a month. The Lambda and S3
charges add a few cents or less at this scale.

The `web-vitals` command ships whether a deployment computes the rollup or not. Without its summary,
the command reports that the window was never computed. `--query` runs the same question from raw
logs.

## One percentile per vital

The rollup calculates p75 with Athena's `approx_percentile`. Web Vitals thresholds use p75 because
it describes the experience of most visits without letting a small number of outliers decide the
result. One percentile keeps the answer aligned with those thresholds, without a p50 or p95 spread.

The answer has one row for each of `lcp`, `cls`, `fcp` and `ttfb`. Route changes, JavaScript errors,
custom event names and non-numeric values are filtered out before the percentile is calculated.

INP is absent. Rainlytics leaves its collection to the `web-vitals` library, and a site reporting
`inp` through that integration still needs a query of its own for now. The [browser
beacon](../beacon/) page covers the collection decision.

`approx_percentile` is approximate. Athena engine changes can also move its answer slightly. Use it
for the performance classification it was designed for, with the sample count beside it.

## The answer is site-wide

Each row groups every reported page together. A quiet site already has few samples in an hour, and
grouping again by page would leave many percentiles resting on one or two visits. `--host` separates
sites where one distribution serves several hostnames.

`--path` has a different job here. It names the collection path in the access log. The default is
`/_rainlytics`, matching `BeaconPath`. A deployment using another collection path records that
narrowing on its summaries:

```typescript
new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  rollups: [...rollups, webVitals],
  requests: { "web-vitals": { paths: ["/_measure"] } },
});
```

The matching query is:

```bash
rainlytics web-vitals --path /_measure --last 7d --query
```

## Small windows move quickly

A percentile from one sample is that sample. With only a handful, each visit can move p75 a long
way. `samples` makes that visible without choosing a universal minimum that would hide a quiet
site's data.

Hourly summaries suit spotting a sudden regression, but the count belongs beside the number. A
longer `--query` run gives a steadier percentile when the hourly sample is sparse:

```bash
rainlytics web-vitals --last 30d --query
```

## Combining stored windows

The p75 of two hours cannot be recovered from the two p75 values. The raw measurements and their
distribution have already been reduced. Averaging the values or weighting them by `samples` would
produce a different statistic from p75 for the combined visits.

For that reason, `webVitals` declares no `totals`. The command reads one stored window and refuses a
span covering several. Use `--query` for one percentile over the whole span.

<!-- card
```bash
rainlytics web-vitals --last 30d --query
```
-->
