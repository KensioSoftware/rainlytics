// The query that counts visitors, and the rows it counts them over.
//
// Apart from `visitor-identity.ts` because that module says what one visitor
// is and this one says how many of them a window saw. The identifier reaches
// no further than this query. Athena counts the distinct digests and hands
// back a number, and nothing writes a digest anywhere.
//
// Apart from `rollup-questions.ts` because a visitor count is not a rollup.
// It answers with one number and no columns to group by, and it rides on a
// summary beside the rows rather than being one of them. `VisitorCount` in
// `rollup-summaries.ts` is where it lands.

import { qualifiedTableName } from "./dataset.js";
import { aPageView } from "./rollup-questions.js";
import { renderedBeaconPath } from "./rendered-visitors.js";
import { aRenderedVisitor } from "./rollup-rows.js";
import type { RollupRequest } from "./rollups.js";
import { rowsFor } from "./rollups.js";
import { visitorIdentifier } from "./visitor-identity.js";

/** What the column holding the count is called. */
export const visitorColumn = "visitors";

/**
 * What the column holding the visitors `renderedOnly` left out is called.
 *
 * Present in the answer of a count asked with `renderedOnly` and absent
 * otherwise. `VisitorCount.unrendered` is where it lands.
 */
export const unrenderedColumn = "unrendered";

/**
 * The rows a visitor is counted over, on top of what `rowsFor` writes.
 *
 * A visitor is somebody who looked at a page. The pageview conditions are
 * therefore the same three the pageviews rollup counts under, and a summary
 * saying 412 views and 317 visitors is two numbers over one set of rows.
 * Counting over every request would count the browser that fetched a
 * stylesheet and the crawler that asked for `robots.txt`.
 *
 * The address test is what leaves out a record that has none. CloudFront
 * writes a hyphen where a field was empty, and a delivery predating
 * KensioSoftware/rainlytics#73 wrote no address at all. `c_ip <> '-'` is
 * false for the first and null for the second, and a `WHERE` clause keeps
 * neither. Left in, they would gather into one identifier and report a
 * visitor nobody was.
 */
const aVisitor: readonly string[] = [...aPageView, "c_ip <> '-'"];

/**
 * The rows one request counts visitors over, as a `WHERE` clause.
 *
 * Apart from the query below so that a reader can ask which rows were counted
 * without reading the count. `visitor-counts.test.ts` is the other caller,
 * and it selects the text a digest is taken over across exactly these rows.
 */
export function visitorRows(request: RollupRequest): string {
  return rowsFor(request, aVisitor);
}

/**
 * How many visitors one request's narrowing saw, as SQL.
 *
 * Written under the `summarisedWindow` range like the question beside it, so
 * both carry `windowPlaceholder` and the job fills both in for the window it
 * is computing. The salt goes in the same way, through
 * `visitorSaltPlaceholder`.
 *
 * The narrowing is the request's own. A summary for `pageviews` over
 * `/blog/` carries the visitors to `/blog/`, and the number answers the
 * question the summary answers.
 *
 * `count(DISTINCT ...)` and not `approx_distinct`. Trino's approximation is
 * a sketch with a standard error around 2.3%, and it is deterministic over
 * one set of rows, so a re-run reproduces it. What it cannot do is answer a
 * question about itself. A reader who counts a day over raw and gets a
 * different number has learned nothing about which of the two is wrong.
 * Exact counting holds the distinct digests of one window in memory, which
 * for a site of this size is thousands.
 *
 * A request asked with `renderedOnly` gets a second column, being the
 * visitors the filter left out. The rows are read without the filter and
 * each digest is counted in one column or the other, by whether its visitor
 * rendered a page. One visitor is one pair, and the test is a function of
 * the pair, so nobody is in both. The second column costs no further scan,
 * since the filter's own subquery is what both columns read.
 *
 * ```typescript
 * visitorCountSql(rollupRequest({ range: summarisedWindow }));
 * ```
 */
export function visitorCountSql(request: RollupRequest): string {
  if (renderedBeaconPath(request.renderedOnly) !== undefined) {
    return renderedVisitorCountSql(request);
  }

  return `${[
    `SELECT count(DISTINCT ${visitorIdentifier}) AS ${visitorColumn}`,
    `  FROM ${qualifiedTableName(request.dataset)}`,
    visitorRows(request),
  ].join("\n")}\n`;
}

/**
 * The visitors who rendered a page, and the ones who did not, as SQL.
 *
 * The rendered test sits in a column rather than the `WHERE` clause, so the
 * visitors it drops are counted rather than lost. A site reading 317
 * visitors and 28 dropped can tell a filter removing a script from one
 * removing its customers.
 *
 * The inner select works the test out once per row and the outer one counts
 * each digest under whichever answer it got. Written into both aggregates
 * instead, the subquery would appear twice and could be read twice.
 */
function renderedVisitorCountSql(request: RollupRequest): string {
  return `${[
    `SELECT count(DISTINCT if(rendered, visitor)) AS ${visitorColumn},`,
    `  count(DISTINCT if(NOT rendered, visitor)) AS ${unrenderedColumn}`,
    "  FROM (",
    `  SELECT ${visitorIdentifier} AS visitor,`,
    `    ${aRenderedVisitor(request)} AS rendered`,
    `  FROM ${qualifiedTableName(request.dataset)}`,
    visitorRows({ ...request, renderedOnly: false }),
    "  )",
  ].join("\n")}\n`;
}
