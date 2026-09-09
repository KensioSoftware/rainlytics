// The question that adds up what beacon events measured.
//
// `beaconEvents` counts rows and `webVitals` takes a percentile. Neither adds
// anything up, so a site measuring something cumulative in the browser had the
// number in every row of its access log and no shipped question that read it.
// Money is the case that found this, in KensioSoftware/rainlytics#158. A shop
// reporting a basket addition, a checkout and a purchase, each carrying an
// amount, needed two rollups written outside the package to answer what it
// took this week.
//
// Opt-in the way `beaconEvents` and `webVitals` are. A site with no beacon
// computes nothing for it and pays for no empty answer.

import {
  aBeaconEvent,
  beaconEventColumn,
  beaconValueColumn,
  onBeaconPath,
} from "./beacon-rows.js";
import { qualifiedTableName } from "./dataset.js";
import { errorEventNames } from "./error-events.js";
import type { Rollup, RollupTotals } from "./rollups.js";
import { rowsFor } from "./rollups.js";
import { oneOf } from "./sql-text.js";
import { vitalEventNames } from "./vital-events.js";

/**
 * How many of one visitor's events of one name an hour counts.
 *
 * The same number and the same reasoning as `beaconEventCap`, and this
 * question sets `identifiesViewers` for the same reason. The collection path
 * is open and unauthenticated, so a client can send the same URL a million
 * times.
 *
 * **The cap bounds rows and not the value each row carries.** That is the
 * limit of it, and it is sharper here than on a count. A flood sending
 * `n=999999999` a million times contributes sixty of those rows to this
 * answer, which is sixty times a number nobody spent. Capping the value
 * itself would clip a genuinely large purchase, and there is no number that
 * separates the two.
 *
 * So a total over an open collection path is a weaker figure than a count
 * over one, and `docs/rollups/` says so. What bounds it properly is the raw
 * store: every row is still there, and a site that finds a flood can work out
 * what it actually took by re-running over rows the cap threw away. The cap
 * is a default that keeps an ordinary answer ordinary, rather than a defence.
 */
export const beaconTotalCap = 60;

/**
 * Who sent a row, for the cap alone.
 *
 * The same pair `beaconEvents` groups by, and it leaves the query no more
 * than it does there. The inner select numbers rows within one sender's hour
 * and the outer one adds up what survived, so no address reaches a summary or
 * a reader.
 */
const sender = "c_ip, cs_user_agent";

/** The hour a row landed in, taken from the row rather than from the window. */
const loggedHour = "cast(timestamp_ms AS bigint) / 3600000";

/** The number an event carried, or null where it carried something else. */
const measuredValue = `try_cast(${beaconValueColumn} AS double)`;

/**
 * Where one row sits among one visitor's events of that name in that hour.
 *
 * Ordered by the row's own timestamp and then by its value, so a re-run keeps
 * the same rows and writes the same total over the one already in the bucket.
 * Two rows agreeing on both contribute the same number whichever the engine
 * puts first.
 *
 * A window function rather than the `least(count(*), cap)` `beaconEvents`
 * uses, because a sum has to know which rows it is adding. Capping the count
 * and summing everything would report sixty events worth a million.
 */
const positionInHour = `row_number() OVER (
    PARTITION BY ${beaconEventColumn}, ${sender}, ${loggedHour}
    ORDER BY timestamp_ms, ${beaconValueColumn}
  )`;

/**
 * The names Rainlytics defines for itself, which this question leaves out.
 *
 * A Web Vital's milliseconds and a layout shift score are numbers that mean
 * nothing added together, and ranked by total they would sit above whatever a
 * site actually measures. `webVitals` answers those and answers them properly.
 * An error carries no number at all.
 *
 * A route change is excluded by carrying no value rather than by name, which
 * is also what keeps a site's own valueless events out.
 */
const rainlyticsEventNames: readonly string[] = [
  ...Object.values(vitalEventNames),
  ...Object.values(errorEventNames),
];

/** Counts and totals, both added across stored windows. */
const beaconTotalsTotals: RollupTotals = { added: ["total", "events"] };

/** What the beacon's own events measured, added up by event name. */
export const beaconTotals: Rollup = {
  name: "beacon-totals",
  summary: "Total the values beacon events carried, by event name.",
  isRanked: true,
  totals: beaconTotalsTotals,
  identifiesViewers: true,
  description: `\
Adds up the number each beacon event carried, grouped by the name it was
reported under, largest total first. \`events\` is how many rows went into
each total.

Only events carrying a number are read. A route change and any other event a
site sends without one are left out entirely rather than counted against a
total of zero. Web Vitals and JavaScript errors are left out by name, since
a percentile is what a vital wants and \`web-vitals\` answers that.

A row whose number cannot be read as one is counted in \`events\` and leaves
\`total\` where it was. So a site can see that something sent a value this
question could not use, rather than losing the row or the total to it.

Negative values are kept. A refund reported as a negative amount is a real
thing to measure, and this is the question that would net it off.

Rainlytics never asks what a number means. \`docs/beacon/\` says to send money
as integer minor units, because a float drifts over a sum of thousands of
rows and a unit on every event would be bytes paid on every Web Vital too.

Narrow to the collection path with \`--path\`, or leave it and take the
beacon's own. Set the same path under \`requests\` when adding this rollup to
\`RollupSummaries\`.

One visitor contributes no more than ${String(beaconTotalCap)} events of one name an hour, which
is what keeps a flood out of the answer. The cap bounds rows and not the
value a row carries, so a client sending an enormous number still contributes
${String(beaconTotalCap)} of them. A total over an open collection path is therefore a weaker
figure than a count over one. Nothing is dropped from the raw store, and a
site that finds a flood can work out what it really took over rows that are
all still there.

A visitor here is the viewer's address and their user agent, which is the
pair a visitor count is hashed from. A deployment delivering no address
cannot compute this question, and \`RollupSummaries\` says so at synthesis.

Totals and counts both add across stored windows, so 24 hourly summaries make
the day.`,
  body: (request) =>
    [
      "SELECT event,",
      "  count(*) AS events,",
      "  coalesce(sum(value), 0) AS total",
      "  FROM (",
      `  SELECT ${beaconEventColumn} AS event,`,
      `    ${measuredValue} AS value,`,
      `    ${positionInHour} AS seen`,
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(onBeaconPath(request), [
        ...aBeaconEvent,
        `NOT (${oneOf(beaconEventColumn, rainlyticsEventNames)})`,
        `${beaconValueColumn} <> ''`,
      ]),
      "  )",
      `  WHERE seen <= ${String(beaconTotalCap)}`,
      "  GROUP BY 1",
      "  ORDER BY 3 DESC, 1",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};
