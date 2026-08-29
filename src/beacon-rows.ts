// Reading a beacon event back off the rows CloudFront wrote.
//
// Apart from `beacon-events.ts` because the two halves have different
// readers. That module builds a query string inside a browser and this one
// builds SQL for Athena, and a site folding the beacon into its own bundle
// was carrying both. KensioSoftware/rainlytics#110 measured what that cost
// and split them.
//
// The payload stays in `cs_uri_query` and is read at query time, the way
// `searches` already reads a search term out of the same column. #100 settled
// that, and `beacon-events.ts` carries the rest of the reasoning along with
// the parameter names these expressions read.

import { decodedParameter } from "./log-encoding.js";
import { quoted } from "./sql-text.js";

import { beaconParameters, defaultBeaconPath } from "./beacon-events.js";

/** The envelope version a row was written under, as SQL. */
export const beaconVersionColumn = decodedParameter(beaconParameters.version);

/** What happened, as SQL. */
export const beaconEventColumn = decodedParameter(beaconParameters.event);

/** The page it happened on, as SQL. */
export const beaconPageColumn = decodedParameter(beaconParameters.page);

/**
 * The rows a beacon event is, as conditions for `rowsFor`.
 *
 * The path is not among them. A rollup narrows to the beacon's path through
 * the request's own `paths`, the way any other question narrows to a section
 * of a site, and a site that moved its beacon then says so in one place.
 *
 * These leave out anything else reaching the same path. A crawler following
 * a beacon URL out of a page's source carries no version parameter, and the
 * bot filter `rowsFor` applies has already taken most of them.
 *
 * ```typescript
 * rowsFor({ ...request, paths: [defaultBeaconPath] }, aBeaconEvent);
 * ```
 */
export const aBeaconEvent: readonly string[] = [
  "cs_method = 'GET'",
  "cs_uri_query <> '-'",
  `${beaconVersionColumn} <> ''`,
];

/**
 * The rows outside the beacon's path, as a condition for `rowsFor`.
 *
 * The other direction from {@link aBeaconEvent}, and it names the path that
 * one leaves out. A question about beacon events narrows to the beacon
 * through the request's own `paths`. A question about what the site answered
 * has to take the beacon's requests back out, and `status-codes` is the one
 * that does.
 *
 * Matched against the column as CloudFront delivered it, where `--path`
 * decodes twice first. The path here is a constant this package chose and it
 * carries nothing a browser or CloudFront escapes, so a record holds it as it
 * was sent. An address somebody typed can hold anything.
 *
 * A prefix, the way every path match in Rainlytics is one.
 */
export const outsideTheBeaconPath = `strpos(cs_uri_stem, ${quoted(
  defaultBeaconPath,
)}) <> 1`;
