// What a beacon event is, and the query string it travels in.
//
// The beacon sends a GET to a path on the site's own domain and puts its
// payload in the query string. CloudFront records `cs-uri-query` whatever the
// cache key and origin forwarding are set to, so the event lands in the same
// objects, the same partitions and the same table as every page request.
// Layer 2 is more rows in the dataset layer 1 already writes, and that is what
// makes the beacon nearly free.
//
// The rows carry different information all the same, and this module is the
// one place saying what. KensioSoftware/rainlytics#100 asked where that
// definition lives and settled three things.
//
// **The fields stay in `cs_uri_query`.** A Glue column on the log table would
// have to be a CloudFront field, because `LogTable` builds its columns from
// what the delivery was configured with, and CloudFront has no field carrying
// somebody else's payload. A view or a second table over the same objects
// runs into the same wall, since no SerDe parses a query string. So the
// payload is read at query time, the way `searches` already reads a search
// term out of the same column.
//
// **Nothing has to be backfilled.** A beacon row is identified by the path it
// was sent to. A query over partitions written before the beacon shipped
// therefore matches no rows at all, rather than answering nulls for a column
// added later. This is the one shape of schema change an immutable store
// takes without argument.
//
// **The envelope is versioned and the payload is not, yet.** Every event
// carries the three parameters below. What each event type puts beside them
// is for the beacon's own issue, and `version` is what lets that arrive
// without reinterpreting rows already written.
//
// This module is the browser's half of that definition, and it imports
// nothing. Every page of a measured site downloads it, so the SQL reading
// these same parameters back off a row lives in `beacon-rows.ts` next door.
// KensioSoftware/rainlytics#110 has what keeping the two together cost a
// bundle.

/**
 * The path a beacon reports to, where a site chooses none.
 *
 * One path, under a leading underscore so it sorts away from a site's own
 * pages and collides with nothing a router already serves. A site names its
 * own where that is taken.
 *
 * The path is what tells a beacon row from a page request, so it has to be a
 * path nothing else answers. Pointing the beacon at a page the site publishes
 * would count every event as a view of it, and download the page body a
 * second time.
 */
export const defaultBeaconPath = "/_rainlytics";

/**
 * The version of the envelope below.
 *
 * Written into every event and read back off every row. The raw store is
 * immutable, so a row written today is still read under today's rules in a
 * year. A query that has to tell two shapes apart has this to tell them
 * apart by.
 */
export const beaconSchemaVersion = 1;

/**
 * The query-string parameters every event carries.
 *
 * One letter each. The whole query string is written into `cs-uri-query` on
 * every event, percent-encoded, and stored for as long as the log objects
 * last. Long names would be paid for on every row and scanned by every query
 * reading the column.
 */
export const beaconParameters = {
  /** The envelope version, being {@link beaconSchemaVersion}. */
  version: "v",

  /** What happened, such as a route change or a web vital. */
  event: "e",

  /** The page it happened on, which the beacon's own path cannot say. */
  page: "p",
} as const;

/** One event, as the beacon reports it. */
export interface BeaconEvent {
  /**
   * What happened.
   *
   * A short name a rollup groups by. The set of them belongs to the beacon
   * rather than to this envelope.
   */
  readonly event: string;

  /**
   * The page it happened on, as a path.
   *
   * The request's own path is the beacon's path, so the page has to travel in
   * the payload. A single-page app changing route is the case this exists
   * for, where the address bar has moved and no request was made.
   */
  readonly page: string;
}

/**
 * One event as a query string, ready to be sent.
 *
 * The browser's own encoding, which is the single pass a request carries.
 * CloudFront adds its own on the way into the record, and
 * `beaconEventColumn` in `beacon-rows.ts` reads both back off.
 *
 * No leading `?`. The caller joins it to the path it is sending to.
 *
 * ```typescript
 * new Image().src = `${path}?${beaconQueryString({ event: "route", page })}`;
 * ```
 */
export function beaconQueryString(event: BeaconEvent): string {
  return [
    [beaconParameters.version, String(beaconSchemaVersion)],
    [beaconParameters.event, event.event],
    [beaconParameters.page, event.page],
  ]
    .map(
      ([name, value]) => `${String(name)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
}
