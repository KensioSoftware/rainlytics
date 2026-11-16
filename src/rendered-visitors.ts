// Whether a row's visitor rendered a page, as a condition.
//
// Apart from `rollup-rows.ts`, which joins this onto every question asked
// with `renderedOnly`, for the reason the bot filter is apart. Every other
// filter there tests the row in front of it. This one tests the visitor
// behind the row against every other row of the window, and it is the only
// condition in a `WHERE` clause that reads the table a second time.

import { qualifiedTableName } from "./dataset.js";
import { defaultBeaconPath } from "./beacon-events.js";
import { onTheBeaconPath } from "./beacon-rows.js";
import type { RenderedBy, RollupRequest } from "./rollups.js";
import { quoted } from "./sql-text.js";

/**
 * What a request for something only a rendering browser fetches ends with.
 *
 * Stylesheets, scripts and fonts, matched against the lowercased path
 * without its query string. A browser laying out a page asks for these and a
 * script reading the HTML does not. In November 2026 a real visit to one
 * shop requested about 35 of them, and 28 automated visitors adding to its
 * basket requested none.
 *
 * Images are left out. A link preview or a feed reader fetches the image a
 * page names in its metadata without rendering anything, and an image is
 * what such a fetcher most often wants.
 */
export const renderingAssetPattern = String.raw`\.(css|js|mjs|woff2?|ttf|otf)$`;

/**
 * What one visitor is, as the text both sides of the test compare.
 *
 * The address and the user agent, which is the pair `visitorText` in
 * `visitor-identity.ts` hashes and the conversion questions group by. Joined
 * by `|`, which an address cannot contain, so one pair's text belongs to that
 * pair alone. A concatenation rather than a row of two columns, because
 * comparing one column against a subquery is the form every engine reads the
 * same way.
 */
const visitorPair = "concat(c_ip, '|', cs_user_agent)";

/**
 * A row whose visitor rendered a page in the same window, as a condition.
 *
 * True where the visitor made any request in the partitions being read for a
 * file matching {@link renderingAssetPattern}, or for anything on the
 * beacon's path. {@link renderedBeaconPath} says which path that is. A site that sends the beacon is therefore covered
 * for a returning browser whose assets all came out of its cache.
 *
 * `partitions` are the conditions saying which partitions and which span the
 * outer query reads, and the subquery reads exactly those. The visitor is
 * judged on the same window the question counts, so an hourly summary and a
 * daily one may disagree about a visit that loaded its assets in one hour and
 * posted to the basket in the next.
 *
 * Nothing else narrows the subquery. A visitor who fetched a stylesheet from
 * another host on the same distribution, or whose stylesheet request carried
 * a status the question leaves out, still rendered the page. A request
 * answered 304 is in the log like any other, and it counts.
 *
 * The subquery is a second scan of the window. Athena reads the address, the
 * user agent and the path of every row in it, beside whatever the outer
 * query reads. `docs/rollups/` has what that costs.
 */
export function renderedVisitor(
  request: RollupRequest,
  partitions: readonly string[],
): string {
  const { dataset } = request;
  const beaconPath =
    renderedBeaconPath(request.renderedOnly) ?? defaultBeaconPath;
  const rendering = [
    `regexp_like(lower(cs_uri_stem), ${quoted(renderingAssetPattern)})`,
    onTheBeaconPath(beaconPath),
  ].join(" OR ");

  return [
    `${visitorPair} IN (`,
    `      SELECT ${visitorPair}`,
    `        FROM ${qualifiedTableName(dataset)}`,
    `        WHERE ${[...partitions, "c_ip <> '-'", `(${rendering})`].join(
      "\n        AND ",
    )})`,
  ].join("\n");
}

/**
 * The beacon path a `renderedOnly` request looks for, or nothing where the
 * filter is off.
 *
 * `true` is the default path. A site that moved its beacon names the path it
 * moved it to. A path that does not start with `/` is refused, since an empty
 * one would match every request and mark every visitor as rendered.
 *
 * @throws {Error} for a beacon path that does not start with `/`.
 */
export function renderedBeaconPath(
  renderedOnly: boolean | RenderedBy | undefined,
): string | undefined {
  if (renderedOnly === undefined || renderedOnly === false) {
    return undefined;
  }

  const path =
    renderedOnly === true ? defaultBeaconPath : renderedOnly.beaconPath;

  if (!path.startsWith("/")) {
    throw new Error(
      `The beacon path "${path}" cannot be matched. Give the path the` +
        ` site's BeaconPath sends to, starting with "/".`,
    );
  }

  return path;
}

/**
 * The rendered test as the conditions of a `WHERE` clause, which is none
 * where the request leaves the filter off.
 */
export function renderedOnlyFor(
  request: RollupRequest,
  partitions: readonly string[],
): readonly string[] {
  return renderedBeaconPath(request.renderedOnly) === undefined
    ? []
    : [renderedVisitor(request, partitions)];
}
