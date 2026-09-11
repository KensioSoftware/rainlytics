// The one pass that turns page requests and conversions into a proportion.
//
// Both conversion questions ask the same thing. How many of the window's
// visitors did the thing, against how many were seen at all. What differs
// between them is which rows count as the conversion: a beacon event in
// `conversion-rollup.ts`, and a request CloudFront already logged in
// `conversion-path-rollup.ts`. Everything else, being the pageview half, the
// visitor pair and the single pass over the table, is the same text.
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

import { qualifiedTableName } from "./dataset.js";
import { aPageView } from "./rollup-questions.js";
import type { RollupRequest } from "./rollups.js";
import { rowsFor } from "./rollups.js";

/** Several conditions as one, for a `CASE` that has to weigh them together. */
export const all = (conditions: readonly string[]): string =>
  `(${conditions.join(" AND ")})`;

/** A row that is somebody looking at a page. */
export const aViewedPage = all(aPageView);

/** How many of one visitor's rows were of a kind, within the window. */
const times = (condition: string): string =>
  `sum(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;

/**
 * The rows a conversion question reads, which are page requests and whatever
 * it counts as a conversion.
 *
 * Site-wide on the pageview half, because the denominator is every visitor the
 * window saw. `paths` is taken off the request rather than passed through: one
 * path filter cannot serve a question reading two kinds of row in one pass,
 * and the conversion half carries its own. `rowsFor` still writes the
 * partitions, the bot filter and the host exactly as it does for every other
 * question.
 *
 * The address test leaves out a record that has none. CloudFront writes a
 * hyphen where a field was empty, and rows without one would gather into a
 * single visitor nobody was.
 */
function overOnePass(request: RollupRequest, aConversion: string): string {
  return rowsFor({ ...request, paths: undefined }, [
    `(${aViewedPage} OR ${aConversion})`,
    "c_ip <> '-'",
  ]);
}

/**
 * How many visitors converted, how many were seen, and the proportion.
 *
 * One pass over the table. The inner select reduces each visitor to whether
 * they looked at a page and whether they converted, and the outer one counts
 * the visitors rather than the rows. The pair reaches no further than the
 * `GROUP BY`.
 *
 * `aConversion` is the condition a converting row satisfies, already written
 * for the request being answered.
 */
export function conversionQuery(
  request: RollupRequest,
  aConversion: string,
): string {
  return [
    "SELECT",
    `  ${times("converted > 0 AND viewed > 0")} AS converted,`,
    `  ${times("viewed > 0")} AS visitors,`,
    `  round(100.0 * ${times("converted > 0 AND viewed > 0")}` +
      ` / nullif(${times("viewed > 0")}, 0), 1) AS converted_percent`,
    "  FROM (",
    `  SELECT ${times(aViewedPage)} AS viewed,`,
    `    ${times(aConversion)} AS converted`,
    `  FROM ${qualifiedTableName(request.dataset)}`,
    overOnePass(request, aConversion),
    "  GROUP BY c_ip, cs_user_agent",
    "  )",
  ].join("\n");
}

/**
 * What every conversion question says about the visitor pair and the window.
 *
 * Appended to each factory's own description. Both carry the same warning
 * about a visit split across two windows and the same promise about the
 * address, and a second copy is the one that goes stale.
 */
export const countingConvertedVisitors = `\
A visitor is the viewer's address and their user agent, which is the pair a
visitor count is hashed from. Neither value leaves the query: the inner
select groups by them and the outer one adds up what that produced, so no
address reaches a summary or a reader. A deployment delivering no address
cannot compute this question, and \`RollupSummaries\` says so at synthesis.

That is also the edge to know about. A reader who looks at 09:59 and converts
at 10:01 is split across two hourly windows and neither sees both halves.
Read this at a day, where almost every visit fits inside one window, and
treat an hour as an indication.

One row, so \`--limit\` does nothing here.

A distinct count belongs to one window. Two windows' counts do not add, the
way two percentiles do not, so this answers from one stored window and offers
\`--query\` over anything longer.`;
