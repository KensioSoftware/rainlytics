// What proportion of the people who looked at a site raised a beacon event.
//
// Every ingredient was already here and nothing related them.
// `visitor-counts.ts` says what one visitor is, `beaconEvents` computes the
// same pair for its flood cap, and a pageview and a `purchase` are two rows in
// one table. No shipped rollup drew a join between them, so conversion rate,
// funnel drop-off and which referrer produced revenue were all unanswerable.
// KensioSoftware/rainlytics#160 drew the first of those.
//
// **This is a factory rather than a rollup.** A site converting on `purchase`
// and on `signup` is asking two questions, and two questions want two names,
// two saved queries and two summary keys. The name a question gets is
// `conversions-<event>`.
//
// A site with no beacon asks the same question of the access log through
// `conversionsOfPath` in `conversion-path-rollup.ts`. The visitor pair, the
// pageview half and the single pass are in `conversion-query.ts`, which both
// read.

import {
  aBeaconEvent,
  beaconEventsJoin,
  beaconEventColumn,
  onTheBeaconPath,
} from "./beacon-rows.js";
import {
  all,
  conversionQuery,
  countingConvertedVisitors,
} from "./conversion-query.js";
import type { Rollup, RollupRequest } from "./rollups.js";
import { assertRollupName } from "./rollups.js";
import { quoted } from "./sql-text.js";

/** A row that is the event this question counts as a conversion. */
const aConversion = (request: RollupRequest, event: string): string =>
  all([
    onTheBeaconPath(request.paths?.at(0)),
    ...aBeaconEvent,
    `${beaconEventColumn} = ${quoted(event)}`,
  ]);

/**
 * The question of how many of a window's visitors raised one event.
 *
 * ```typescript
 * new RollupSummaries(this, "Summaries", {
 *   table,
 *   workgroup,
 *   rollups: [...rollups, conversionsOf("purchase")],
 * });
 * ```
 *
 * The denominator is every visitor the window saw, being the same rows and
 * the same definition `visitor-counts.ts` counts over. The numerator is the
 * visitors among them who also raised `event`. A visitor who raised it
 * without looking at a page in the same window counts in neither, which is
 * what keeps the proportion at or below one.
 *
 * That last rule is also this question's sharpest edge. A reader who looks at
 * 09:59 and buys at 10:01 is one visitor split across two hourly windows, and
 * neither window sees both halves. The answer is therefore honest at a day
 * and noisy at an hour, and `docs/rollups/` says so.
 *
 * A distinct count belongs to the window it was taken over. Two windows'
 * counts cannot be added, the way two percentiles cannot, so this declares no
 * totals and a command asked about a longer span reports the windows it found
 * and offers the query that would cover them.
 *
 * {@link conversionsOfPath} answers the same question off the access log,
 * for a site that ships no beacon.
 *
 * @throws {Error} where the event name would make a name no subcommand and no
 *   CDK logical id could carry.
 */
export function conversionsOf(event: string): Rollup {
  assertRollupName(`conversions-${event}`);

  return {
    name: `conversions-${event}`,
    summary: `Show how many visitors raised the "${event}" event.`,
    isRanked: false,
    identifiesViewers: true,
    description: `\
Shows how many of the window's visitors raised the \`${event}\` beacon event,
against how many were seen at all.

\`visitors\` counts everybody who looked at a page, which is the same rows the
visitor count beside \`pageviews\` is taken over. \`converted\` counts the ones
who also raised \`${event}\`. Somebody who raised it without looking at a page
in the same window counts in neither, which is what holds the proportion at
or below one.

The collection path defaults to the beacon's own. Use \`--path\` for a beacon
deployed somewhere else, and set the same path under \`requests\` when adding
this rollup to \`RollupSummaries\`. The visitors counted are site-wide either
way, since the denominator is everybody the window saw.

${countingConvertedVisitors}`,
    body: (request) =>
      conversionQuery(request, aConversion(request, event), [
        beaconEventsJoin(),
      ]),
  };
}
