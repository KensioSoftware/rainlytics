// The percentile question over the Web Vitals the beacon reported.
//
// A percentile belongs to the rows in one window. Two p75 values cannot be
// combined into the p75 of both windows. This rollup therefore declares no
// totals. A command reading several summaries refuses to invent that number
// and offers a query over the whole span.

import { defaultBeaconPath } from "./beacon-events.js";
import {
  aBeaconEvent,
  beaconEventColumn,
  beaconValueColumn,
} from "./beacon-rows.js";
import { qualifiedTableName } from "./dataset.js";
import type { Rollup, RollupRequest } from "./rollups.js";
import { rowsFor } from "./rollups.js";
import { oneOf, quoted } from "./sql-text.js";
import { vitalEventNames } from "./vital-events.js";

/** The percentile Web Vitals thresholds are defined against. */
export const webVitalsPercentile = 0.75;

/** The numeric value an event carried. */
const measuredValue = `try_cast(${beaconValueColumn} AS double)`;

/** Decimal text, including the exponent JavaScript writes for some numbers. */
const aNumericValue = `regexp_like(${beaconValueColumn}, ${quoted(
  String.raw`^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`,
)})`;

/** The beacon path a request counts, with the package default filled in. */
const onBeaconPath = (request: RollupRequest): RollupRequest => ({
  ...request,
  paths: request.paths ?? [defaultBeaconPath],
});

/** The p75 of each Web Vital reported across the site. */
export const webVitals: Rollup = {
  name: "web-vitals",
  summary: "Show the 75th percentile of each reported Web Vital.",
  isRanked: false,
  description: `\
Shows the 75th percentile of each Web Vital the beacon reported, across the
site and over the window being read.

The four event names are \`lcp\`, \`cls\`, \`fcp\` and \`ttfb\`. Route changes,
errors and events a site named for itself are left out before their values
reach the arithmetic. A negative value or one that cannot be read as a number
is left out too.

The 75th percentile is the value Web Vitals thresholds are defined against.
\`samples\` says how many measurements it came from. A percentile over a quiet
hour can move with one visit, and the count keeps that visible.

The answer is site-wide. Splitting a quiet site by page makes each percentile
rest on fewer samples. \`--host\` narrows a distribution serving several sites.

The collection path defaults to \`${defaultBeaconPath}\`. Use \`--path\` for a
beacon deployed somewhere else, and set the same path under \`requests\` when
adding this rollup to \`RollupSummaries\`.

Percentiles from two stored windows do not combine into the percentile of the
two together. Read one stored window at a time, or use \`--query\` to calculate
one percentile over a longer span.`,
  body: (request) =>
    [
      `SELECT ${beaconEventColumn} AS vital,`,
      `  approx_percentile(${measuredValue}, ${String(webVitalsPercentile)}) AS p75,`,
      `  count(${measuredValue}) AS samples`,
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(onBeaconPath(request), [
        ...aBeaconEvent,
        oneOf(beaconEventColumn, Object.values(vitalEventNames)),
        aNumericValue,
        `${measuredValue} IS NOT NULL`,
        `${measuredValue} >= 0`,
      ]),
      "  GROUP BY 1",
      "  ORDER BY 1",
    ].join("\n"),
};
