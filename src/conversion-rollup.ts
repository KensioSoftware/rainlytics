// What proportion of the people who looked at a site did the thing.
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
// **The visitor is the raw pair, not the salted digest.** `visitorIdentifier`
// carries `visitorSaltPlaceholder`, and the summary job fills that in for the
// visitor count alone. A question's own SQL gets the window and nothing else,
// so a body carrying the placeholder would reach Athena still holding it and
// be refused, which is what the placeholder is for. `beaconEvents` has the
// same need and answers it the same way: group by `c_ip, cs_user_agent`, let
// the pair reach no further than the `GROUP BY`, and set `identifiesViewers`
// so a deployment with no address is refused at synthesis. Nothing here
// writes an address into a summary, a result object or a reader's terminal.

import {
  aBeaconEvent,
  beaconEventColumn,
  onTheBeaconPath,
} from "./beacon-rows.js";
import { qualifiedTableName } from "./dataset.js";
import { aPageView } from "./rollup-questions.js";
import type { Rollup, RollupRequest } from "./rollups.js";
import { assertRollupName, rowsFor } from "./rollups.js";
import { quoted } from "./sql-text.js";

/** Several conditions as one, for a `CASE` that has to weigh them together. */
const all = (conditions: readonly string[]): string =>
  `(${conditions.join(" AND ")})`;

/** A row that is somebody looking at a page. */
const aViewedPage = all(aPageView);

/** A row that is the event this question counts as a conversion. */
const aConversion = (request: RollupRequest, event: string): string =>
  all([
    onTheBeaconPath(request.paths?.at(0)),
    ...aBeaconEvent,
    `${beaconEventColumn} = ${quoted(event)}`,
  ]);

/** How many of one visitor's rows were of a kind, within the window. */
const times = (condition: string): string =>
  `sum(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;

/**
 * The rows this reads, which are page requests and one kind of beacon event.
 *
 * Site-wide on the pageview half, because the denominator is every visitor the
 * window saw. `paths` on the request names the beacon's own collection path
 * instead, the way it does for every other question over beacon rows, and it
 * reaches the beacon half alone through {@link aConversion}. So `rowsFor` is
 * handed a request with no paths on it, and still writes the partitions, the
 * bot filter and the host exactly as it does for every other question.
 *
 * The address test leaves out a record that has none. CloudFront writes a
 * hyphen where a field was empty, and rows without one would gather into a
 * single visitor nobody was.
 */
const overOnePass = (request: RollupRequest, event: string): string =>
  rowsFor({ ...request, paths: undefined }, [
    `(${aViewedPage} OR ${aConversion(request, event)})`,
    "c_ip <> '-'",
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

A visitor is the viewer's address and their user agent, which is the pair a
visitor count is hashed from. Neither value leaves the query: the inner
select groups by them and the outer one adds up what that produced, so no
address reaches a summary or a reader. A deployment delivering no address
cannot compute this question, and \`RollupSummaries\` says so at synthesis.

\`visitors\` counts everybody who looked at a page, which is the same rows the
visitor count beside \`pageviews\` is taken over. \`converted\` counts the ones
who also raised \`${event}\`. Somebody who raised it without looking at a page
in the same window counts in neither, which is what holds the proportion at
or below one.

That is also the edge to know about. A reader who looks at 09:59 and buys at
10:01 is split across two hourly windows and neither sees both halves. Read
this at a day, where almost every visit fits inside one window, and treat an
hour as an indication.

The collection path defaults to the beacon's own. Use \`--path\` for a beacon
deployed somewhere else, and set the same path under \`requests\` when adding
this rollup to \`RollupSummaries\`. The visitors counted are site-wide either
way, since the denominator is everybody the window saw.

One row, so \`--limit\` does nothing here.

A distinct count belongs to one window. Two windows' counts do not add, the
way two percentiles do not, so this answers from one stored window and offers
\`--query\` over anything longer.`,
    body: (request) =>
      [
        "SELECT",
        `  ${times("converted > 0 AND viewed > 0")} AS converted,`,
        `  ${times("viewed > 0")} AS visitors,`,
        `  round(100.0 * ${times("converted > 0 AND viewed > 0")}` +
          ` / nullif(${times("viewed > 0")}, 0), 1) AS converted_percent`,
        "  FROM (",
        `  SELECT ${times(aViewedPage)} AS viewed,`,
        `    ${times(aConversion(request, event))} AS converted`,
        `  FROM ${qualifiedTableName(request.dataset)}`,
        overOnePass(request, event),
        "  GROUP BY c_ip, cs_user_agent",
        "  )",
      ].join("\n"),
  };
}
