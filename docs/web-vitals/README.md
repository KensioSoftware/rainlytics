# Web Vitals

The `web-vitals` command reports the 75th percentile of each performance measurement collected by
the browser module. A p75 value means that approximately 75% of the recorded measurements are at
or below it.

Add the optional rollup to your scheduled questions:

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

## Load with your existing bundle

Call `reportVitals` from your site's existing bundle. It can read measurements recorded before
the bundle loaded, including when the script uses `async` or `defer`:

- LCP, CLS and FCP use `PerformanceObserver` with `buffered: true` to receive earlier entries.
- TTFB uses the navigation timing entry retained by the browser.

The measurements cover the document in which `reportVitals` started. SPA route changes do not
start a new set of measurements. LCP and CLS are sent when the document first becomes hidden.
They are not sent if the browser never reports that visibility change.

## How many requests a page view sends

Web Vitals usually add two requests per document:

1. TTFB and FCP are sent together when FCP becomes available.
2. LCP and CLS are sent together when the document becomes hidden.

The wait for FCP lasts four seconds from the call to `reportVitals`. If it takes longer, TTFB is
sent alone. FCP is then sent when available, making three requests if all four measurements are
collected. If the document becomes hidden during the wait, TTFB goes with LCP and CLS.

The timeout preserves TTFB measurements from pages that never report a paint, including some
crawlers. A document that stays visible can still report TTFB and FCP.

## Calculation

The rollup uses Athena `approx_percentile` to calculate p75 separately for TTFB, FCP, LCP and CLS.
It ignores route events, errors, custom event names, negative values and invalid numbers.

The answer covers all reported pages. Use `--host` when one distribution serves several
hostnames. `--path` selects the beacon collection path. It cannot filter by the page inside an
event.

INP is absent from the shipped rollup. A site can collect it through `web-vitals` and define a
custom rollup.

## Read a useful sample

Check `samples` alongside `p75`. With one sample, p75 is simply that measurement. Small samples
can produce large changes between hours.

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
