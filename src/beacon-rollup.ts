// The question over beacon rows, and the rule that bounds a flood of them.
//
// The collection path is unauthenticated and idempotent by design, so anybody
// can send its URL a million times and have every one of them counted, under
// a page value naming a page nobody opened. Stopping that at the edge takes a
// request counter, and the only place at the edge that keeps one is AWS WAF at
// $6.00 a month before a request reaches it. `docs/abuse/` has that arithmetic
// and why no WAF construct ships here.
//
// So the judgement lives in the query, beside the crawler filter every
// question already applies. The raw store keeps every row and the question
// decides what to count, which makes a rule that turns out wrong a re-run
// rather than data nobody can recover.
//
// KensioSoftware/rainlytics#104 chose between three candidates.
//
// **A cap per visitor.** The one taken, and it is written out under
// {@link beaconEventCap} below.
//
// **Dropping events whose page never appears as a pageview in the same
// window.** Rejected. A route change in a single-page app is the case the
// beacon exists for, and its page was never a document request, so this drops
// exactly the events layer 2 was built to collect.
//
// **A cap per path.** Rejected. A popular page legitimately carries many
// events, so a cap low enough to bound a flood clips real traffic and one
// high enough to spare real traffic lets a flood through underneath it.
//
// This question has no subcommand. It is exported for a site running the
// beacon to add to its own summaries, and a deployment with no beacon computes
// nothing for it.

import { defaultBeaconPath } from "./beacon-events.js";
import {
  aBeaconEvent,
  beaconEventColumn,
  beaconPageColumn,
} from "./beacon-rows.js";
import { qualifiedTableName } from "./dataset.js";
import type { Rollup, RollupTotals } from "./rollups.js";
import { rowsFor } from "./rollups.js";

/**
 * How many of one visitor's identical events an hour counts.
 *
 * Sixty, which is one a minute for a solid hour from one person, on one page,
 * of one event name. A reader who moves around a site produces events on
 * several pages and is capped on each of them separately. A client sending the
 * same URL a million times contributes sixty.
 *
 * A number rather than a proportion, because a proportion of what a window
 * holds moves with the flood that poisoned it. The cap has to be something a
 * real visitor stays under and an attacker cannot lift.
 *
 * The hour is the row's own, taken from `timestamp_ms` rather than from the
 * window being computed. One query text serves both cadences, and an hourly
 * summary and the daily summary covering it therefore apply the same cap.
 * That is also what makes 24 hourly summaries add up to the daily one.
 */
export const beaconEventCap = 60;

/**
 * Who sent a row, for the cap alone.
 *
 * The same pair a visitor count is hashed from, and the reason this question
 * needs the viewer address delivered. Neither value leaves the query. The
 * inner `SELECT` groups by them and the outer one adds up what that produced,
 * so no address reaches a summary, a result object or a reader.
 *
 * A delivery carrying no address has no column here and cannot answer this
 * question at all. `RollupSummaries` refuses it at synthesis rather than
 * failing once an hour in a bucket nobody is watching.
 *
 * Two people behind one household address and one browser count as one
 * visitor, which is the direction that under-counts. A client rotating
 * addresses counts as many, which is the direction that lets a flood through.
 * Both are true of the visitor count already, and `docs/visitors/` has them.
 */
const sender = "c_ip, cs_user_agent";

/**
 * The hour a row landed in, as a number to group by.
 *
 * Integer division of the millisecond timestamp, which is exact and reads one
 * column. `date_trunc` over a converted timestamp says the same thing and
 * makes the engine build a timestamp per row to throw it away again.
 */
const loggedHour = "cast(timestamp_ms AS bigint) / 3600000";

/** One visitor's identical events in one hour, counted no further than the cap. */
const cappedCount = `least(count(*), ${String(beaconEventCap)})`;

/** Events by page and by name, added by both. */
const beaconEventTotals: RollupTotals = { added: ["events"] };

/** What the beacon reported, most reported first, with floods bounded. */
export const beaconEvents: Rollup = {
  name: "beacon-events",
  summary: "Count beacon events by page and by name.",
  isRanked: true,
  totals: beaconEventTotals,
  identifiesViewers: true,
  description: `\
Counts what the beacon reported, by the page an event happened on and the
name it was reported under.

The page comes out of the query string rather than out of the request, since
the request was sent to the beacon's own path. A route change in a
single-page app is what that exists for, where the address bar has moved and
no request was made.

Narrow to the collection path with \`--path ${defaultBeaconPath}\`, or to
whatever path the beacon reports to. Without it this counts every request on
the site carrying a \`v\` parameter, and \`?v=3\` on a stylesheet is an
ordinary thing for a site to serve.

One visitor's identical events are counted no more than ${String(beaconEventCap)} times an
hour. That is one a minute from one person, on one page, of one event name.
The collection path is open and unauthenticated, so a client can send the
same URL a million times, and this is what keeps those out of the answer
without keeping them out of the log. The cap is applied per hour of the
row's own timestamp, so an hour and the day holding it are capped the same
way and the hours of a day add up to it.

A visitor here is the viewer's address and their user agent, which is the
pair a visitor count is hashed from. A deployment delivering no address
cannot compute this question, and \`RollupSummaries\` says so at synthesis.

Nothing is dropped from the raw store. A rule that turns out to be wrong is
a re-run over rows that are all still there.`,
  body: (request) =>
    [
      "SELECT page, event, sum(counted) AS events",
      "  FROM (",
      `  SELECT ${beaconPageColumn} AS page,`,
      `    ${beaconEventColumn} AS event,`,
      `    ${cappedCount} AS counted`,
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, aBeaconEvent),
      `  GROUP BY 1, 2, ${sender}, ${loggedHour}`,
      "  )",
      "  GROUP BY 1, 2",
      "  ORDER BY 3 DESC, 1, 2",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};
