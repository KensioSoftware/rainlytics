# Web Vitals

The `web-vitals` command reports the 75th percentile of each performance measurement collected by
the browser module.

```typescript
import { rollups, webVitals } from "@kensio/rainlytics";

new RollupSummaries(this, "Summaries", {
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

LCP, FCP and TTFB use milliseconds. CLS is a unitless score. `samples` shows how many numeric
measurements produced the percentile.

## Enable collection

```typescript
import { startBeacon } from "@kensio/rainlytics/beacon";
import { reportVitals } from "@kensio/rainlytics/beacon/vitals";

const beacon = startBeacon();
reportVitals(beacon);
```

The optional rollup stays outside the defaults because a site without vital events would pay for
empty Athena queries. Adding it under the default schedule adds 50 queries a day.

## Start it wherever the bundle runs

`reportVitals` can run late. A bundle loaded `async defer` at the end of `<body>` is already past
the largest paint on a fast page, and every one of the four measurements survives that:

- LCP, CLS and FCP come from `PerformanceObserver` with `buffered: true`, which hands over the
  entries the browser recorded before the observer existed.
- TTFB comes off the navigation timing entry, which the browser keeps for the life of the document.

So put it wherever the rest of the site's JavaScript goes. Moving it earlier costs a blocking script
on every page and buys no samples.

Two things do lose measurements, and neither is about when the bundle runs. `reportVitals` measures
the document it started in, so a single-page app reports one set of vitals per document rather than
one per route. And LCP and CLS are only final once the page is going away, so a document the browser
never hides reports neither. Following a link, closing the tab and switching app all hide it first.

## Calculation

The rollup uses Athena `approx_percentile` to calculate p75 separately for TTFB, FCP, LCP and CLS.
It ignores route events, errors, custom event names, negative values and invalid numbers.

The answer is site-wide. Use `--host` when one distribution serves several hostnames. `--path`
selects the beacon collection path, not the page reported inside each event.

INP is absent from the shipped rollup. A site can collect it through `web-vitals` and define a
custom rollup.

## Read a useful sample

A percentile from one sample is that sample. Small hourly samples can move sharply, so read
`samples` beside `p75`.

Run one longer Athena query for a steadier value:

```bash
rainlytics web-vitals --last 30d --query
```

Several stored p75 values cannot be combined into the p75 for their combined raw measurements.
Weighting or averaging them produces another statistic. The command therefore reads a single stored
window or requires `--query` for a range covering several windows.

<!-- card
```bash
rainlytics web-vitals --last 30d --query
```
-->
