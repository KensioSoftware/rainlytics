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
import type { RollupRequest } from "./rollups.js";
import { quoted } from "./sql-text.js";

import {
  beaconEventFields,
  beaconEventSeparator,
  beaconFieldSeparator,
  beaconParameters,
  beaconSchemaVersion,
  defaultBeaconPath,
} from "./beacon-events.js";

/** The envelope version a row was written under, as SQL. */
export const beaconVersionColumn = decodedParameter(beaconParameters.version);

/**
 * What the unnested events are called in a query that joins them.
 *
 * {@link beaconEventsJoin} names one column under this alias, holding one
 * packed event. Every column below reads a field out of it.
 */
export const beaconEventsAlias = "beacon";

/** The column {@link beaconEventsJoin} unnests each packed event into. */
const packedEventColumn = `${beaconEventsAlias}.packed`;

/**
 * The whole URL a record holds, as the two columns CloudFront split it into.
 *
 * `decodedParameter` joins the same two. This one is here because the reader
 * below needs a parameter with one pass of encoding left on it, where that
 * function takes both off.
 */
const wholeUrl = "cs_uri_stem || '?' || cs_uri_query";

/**
 * One version 1 parameter, with CloudFront's pass off it and the browser's
 * still on.
 *
 * `url_extract_parameter` decodes once, which undoes what CloudFront did on
 * the way into the record and leaves what the browser encoded. Version 1
 * encoded each value once, so one pass is all there is to take off, and what
 * is left sits at the depth a field inside a packed event sits at.
 *
 * The packed parameter needs two passes rather than this one, because the
 * browser encoded the whole packed string on top of the pass each field
 * already carried. {@link beaconPackedEvents} has the difference.
 */
function halfDecodedParameter(parameter: string): string {
  return `coalesce(url_extract_parameter(${wholeUrl}, ${quoted(parameter)}), '')`;
}

/**
 * One row's events, packed, whichever version wrote the row.
 *
 * Two shapes live in the store at once and this is what reconciles them.
 * Version 1 wrote one event per row across five parameters. Version 2 packs
 * every event of a request into `b`, and #177 has why. The raw store is
 * immutable, so both keep arriving here for as long as the log objects last,
 * out of the same partitions and often the same objects.
 *
 * The version is read off the row rather than inferred from its date. A
 * deployment upgrades when it upgrades, and a partition holds whatever was
 * being sent while it was open.
 *
 * A version 1 row is repacked into the version 2 shape rather than read by a
 * reader of its own. The five parameters go into five positions, joined by
 * the same separator, and everything downstream then reads one shape.
 *
 * The two versions reach that shape through a different number of passes.
 * Version 1 encoded each value once and CloudFront encoded the record once,
 * so one `url_decode` leaves the value ready to be a field. Version 2 encoded
 * each field, encoded the whole packed string on top, and CloudFront encoded
 * the record over both, so it takes two. Both then hold a field carrying
 * exactly one pass, which is what the reader below takes off.
 *
 * It is also what makes the separators safe on an old row. Version 1 encoded
 * each value whole, and `encodeURIComponent` escapes both a comma and a
 * semicolon, so an error message written in 2026 holding either one repacks
 * into exactly one event.
 *
 * A row that is not a beacon event at all repacks to empty fields and unnests
 * to one event with no name. `aBeaconEvent` is what drops it.
 */
export function beaconPackedEvents(): string {
  const version1 = [
    beaconParameters.event,
    beaconParameters.page,
    beaconParameters.value,
    beaconParameters.subject,
    beaconParameters.message,
  ]
    .map((parameter) => halfDecodedParameter(parameter))
    .join(` || ${quoted(beaconFieldSeparator)} || `);

  const version2 = `coalesce(${decodedParameter(beaconParameters.events)}, '')`;

  return `if(${beaconVersionColumn} = ${quoted(
    String(beaconSchemaVersion),
  )}, ${version2}, ${version1})`;
}

/**
 * One field of the packed event a row unnested to, as SQL.
 *
 * `split_part` rather than an array subscript, because a packed event stops
 * at its last filled field. An event carrying no message is four fields long
 * and `split_part` answers empty past the end rather than raising. A sixth
 * field added later reads the same way over every row already written.
 *
 * The `url_decode` here is the third pass. `beaconPackedEvents` left one on
 * every field, which is what kept a comma inside an error message from ending
 * the field it sits in.
 */
function packedField(field: (typeof beaconEventFields)[number]): string {
  const position = beaconEventFields.indexOf(field) + 1;

  return `url_decode(split_part(${packedEventColumn}, ${quoted(
    beaconFieldSeparator,
  )}, ${String(position)}))`;
}

/**
 * The join that turns one row into its events.
 *
 * Every question over beacon events reads through this. A row carries one
 * event or several depending on the version that wrote it, and a query
 * selecting the fields straight off the row would answer one event for a
 * version 2 row holding four.
 *
 * `CROSS JOIN` rather than a left join, and it drops nothing. `split` answers
 * one empty element for an empty string, so a row with no payload still
 * contributes exactly one event, which `aBeaconEvent` then rejects on its
 * empty name. A question counting page requests and beacon events in one
 * pass depends on that, and `conversion-query.ts` is the one that does.
 *
 * ```typescript
 * [`FROM ${qualifiedTableName(request.dataset)}`, beaconEventsJoin()].join("\n");
 * ```
 */
export function beaconEventsJoin(): string {
  return (
    `  CROSS JOIN UNNEST(split(${beaconPackedEvents()},` +
    ` ${quoted(beaconEventSeparator)})) AS ${beaconEventsAlias} (packed)`
  );
}

/** What happened, as SQL. */
export const beaconEventColumn = packedField("event");

/** The page it happened on, as SQL. */
export const beaconPageColumn = packedField("page");

/**
 * The number an event measured, as SQL.
 *
 * Text, the way every one of these is text. The column reads empty for an
 * event that measured nothing, and a question wanting arithmetic casts it
 * itself over rows it has already narrowed to one event name. Casting here
 * would answer 0 for every route change, and a percentile over those zeroes
 * would be a plausible number that is wrong.
 */
export const beaconValueColumn = packedField("value");

/**
 * What an event was about, as SQL.
 *
 * A SKU, an order reference or a plan name, whichever the site sent. Text,
 * and empty for an event that named nothing.
 *
 * Apart from {@link beaconMessageColumn} because the two carry different
 * risks. This holds an identifier the site already publishes. That one holds
 * whatever the site's own code wrote, which is the column a deployment
 * keeping no personal data has to think about.
 */
export const beaconSubjectColumn = packedField("subject");

/**
 * The text an event carries, as SQL.
 *
 * The only column here that can hold anything a site's own code wrote. A
 * deployment that delivers no viewer address to hold no personal data should
 * read `docs/beacon/` before turning error reporting on, because this is the
 * way back in.
 */
export const beaconMessageColumn = packedField("message");

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
  `${beaconEventColumn} <> ''`,
];

/**
 * One request with the beacon's path filled in, where nobody named one.
 *
 * Every question over beacon rows needs this and each of them had its own
 * copy. A rollup that leaves it out counts every request on the site carrying
 * a `v` parameter, and `/main.a1b2c3.js?v=3` is an ordinary thing for a site
 * to serve.
 *
 * Exported for the reason `rowsFor` is. A site writing a question of its own
 * over beacon rows needs the same four lines, and a hand-written copy is a
 * second statement of the rule.
 *
 * A request that named its own paths keeps them, so a site whose beacon
 * reports somewhere else says so once.
 *
 * ```typescript
 * rowsFor(onBeaconPath(request), aBeaconEvent);
 * ```
 */
export function onBeaconPath(request: RollupRequest): RollupRequest {
  return { ...request, paths: request.paths ?? [defaultBeaconPath] };
}

/**
 * The rows on the beacon's path, as a condition.
 *
 * The positive twin of {@link outsideTheBeaconPath}, and it takes the path
 * rather than assuming the default, so a site that moved its beacon says so.
 *
 * Different from {@link onBeaconPath}, which narrows a whole request to the
 * beacon and is what almost every question over beacon rows wants. This is
 * for the one reading beacon rows and page requests in a single pass, where
 * one path filter on the request cannot serve both halves.
 *
 * A prefix, the way every path match in Rainlytics is one, and matched
 * against the column as CloudFront delivered it for the reason
 * {@link outsideTheBeaconPath} gives.
 */
export function onTheBeaconPath(path: string = defaultBeaconPath): string {
  return `strpos(cs_uri_stem, ${quoted(path)}) = 1`;
}

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
