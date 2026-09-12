// What a beacon event is, and the query string it travels in.
//
// The beacon sends a GET to a path on the site's own domain and puts its
// payload in the query string. CloudFront records `cs-uri-query` whatever the
// cache key and origin forwarding are set to, so the event lands in the same
// objects, the same partitions and the same table as every page request.
// Layer 2 is more rows in the dataset layer 1 already writes.
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
// **The envelope is versioned and the payload is not.** `version` is what
// lets a later shape arrive without reinterpreting rows already written, and
// #177 is the case it was built for. Version 1 carried exactly one event per
// request. Version 2 carries as many as the caller hands over, because a
// request is the thing a CloudFront flat-rate plan meters and four vitals a
// page view were costing four of them.
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
 * immutable, so a row written under version 1 is still read under version 1
 * rules in a year, in the same partitions as the version 2 rows beside it.
 * `beaconEventsOf` in `beacon-rows.ts` is the reader that tells them apart.
 *
 * Version 2 replaced one event per request with a list of them. #159 and #112
 * both added a parameter and left this at 1, because a reader took the first
 * three back off a new row unchanged. This one moves the payload into a
 * parameter of its own, and a version 1 reader would find none of what it
 * expects.
 */
export const beaconSchemaVersion = 2;

/**
 * The query-string parameters an event travels in.
 *
 * One letter each. The whole query string is written into `cs-uri-query` on
 * every event, percent-encoded, and stored for as long as the log objects
 * last. Long names would be paid for on every row and scanned by every query
 * reading the column.
 *
 * Only `version` and `events` are written today. The five below them are what
 * version 1 wrote, and they are here because the rows are still in the store
 * and still read. Nothing in the browser emits them.
 */
export const beaconParameters = {
  /** The envelope version, being {@link beaconSchemaVersion}. */
  version: "v",

  /** Every event in the request, packed by {@link beaconQueryString}. */
  events: "b",

  /** Version 1 only. What happened. */
  event: "e",

  /** Version 1 only. The page it happened on. */
  page: "p",

  /** Version 1 only. A number the event measured. */
  value: "n",

  /** Version 1 only. What the event was about, such as a SKU. */
  subject: "s",

  /** Version 1 only. Text the event carried, such as what an error said. */
  message: "m",
} as const;

/**
 * What each position in a packed event holds, in the order it is written.
 *
 * The browser writes a field per position and `beaconEventsOf` in
 * `beacon-rows.ts` reads one back per position. Two statements of an order
 * drift, and the way they drift is a reader that starts answering a page
 * where a question asked for an event name.
 *
 * A sixth field appends. A reader indexing by position finds nothing at the
 * new one over every row already written, which is the same answer it gives
 * for a field the event left empty.
 */
export const beaconEventFields = [
  "event",
  "page",
  "value",
  "subject",
  "message",
] as const;

/** What separates one field from the next inside a packed event. */
export const beaconFieldSeparator = ",";

/** What separates one packed event from the next. */
export const beaconEventSeparator = ";";

/**
 * The most a collection request may carry, in characters of path and query.
 *
 * CloudFront refuses a URL past roughly 8 KB, and a refused request loses
 * every event in it rather than the last one that would not fit. Version 1
 * could only ever overflow on a single event, and `errorMessageLimit` is what
 * bounds the one field long enough to do it. Version 2 puts a caller in
 * charge of how many events go in a request, so the ceiling has to be kept
 * here rather than assumed.
 *
 * Under the limit rather than at it. The margin covers the request line and
 * the headers around it, none of which this can see.
 *
 * `sendBeaconEvents` splits a list that would exceed this across as many
 * requests as it takes, so the events still arrive. A single event that
 * exceeds it on its own is sent anyway, because dropping it would be a
 * measurement silently lost where CloudFront refusing it is one that can be
 * seen.
 */
export const beaconRequestLimit = 8000;

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
   *
   * Carried per event rather than once per request. Two events batched
   * together are often two vitals for one page, and they are sometimes a
   * route change and whatever the site raised on the page before it.
   */
  readonly page: string;

  /**
   * A number the event measured, where it measured one.
   *
   * A web vital is the case this exists for. Left off an event that measured
   * nothing, and the position is then empty rather than absent, which keeps
   * every field after it where a reader expects to find it.
   *
   * Apart from {@link message} because a number can hold no personal data and
   * text can. `docs/beacon/` has what that separation buys a site.
   */
  readonly value?: number | undefined;

  /**
   * What the event is about, where it is about something nameable.
   *
   * A SKU, an order reference or a plan name, sitting beside the number in
   * {@link value}. An amount with nothing saying what it was paid for is a
   * total and nothing else.
   *
   * Chosen by the site rather than written by its code, which is what
   * separates this from {@link message}. A SKU is an identifier a site
   * already publishes. An error message is whatever the browser or the
   * site's own code produced, and can hold anything.
   */
  readonly subject?: string | undefined;

  /**
   * Text the event carries, where it carries any.
   *
   * What an error said is the case this exists for. Whatever goes in here is
   * written into the access log and kept for as long as the log objects are,
   * so a site holding no personal data has to know what its own code puts in
   * an error message. `docs/beacon/` has that in full.
   */
  readonly message?: string | undefined;
}

/**
 * Every field of one event, encoded and joined, with empty positions at the
 * end dropped.
 *
 * The encoding is what makes the separators safe. `encodeURIComponent`
 * escapes both a comma and a semicolon, so neither survives inside a value,
 * and an error message holding either one packs and unpacks unchanged.
 */
function packEvent(event: BeaconEvent): string {
  const fields = beaconEventFields.map((field) => {
    const value = event[field];

    return value === undefined ? "" : encodeURIComponent(String(value));
  });

  while (fields.length > 0 && fields.at(-1) === "") {
    fields.pop();
  }

  return fields.join(beaconFieldSeparator);
}

/**
 * Events as a query string, ready to be sent.
 *
 * Two parameters. The version, and every event packed into one value.
 *
 * The browser's own encoding is the single pass a request carries. CloudFront
 * adds its own on the way into the record, and `beaconEventsOf` in
 * `beacon-rows.ts` reads both back off before it splits anything. The fields
 * inside the packed value carry a pass of their own underneath those two,
 * which is what keeps a separator out of a value.
 *
 * No leading `?`. The caller joins it to the path it is sending to.
 *
 * An empty list still produces a query string, and the row it writes holds no
 * events. `sendBeaconEvents` is where that request is not made.
 *
 * ```typescript
 * beaconQueryString([{ event: "lcp", page: "/", value: 2400 }]);
 * beaconQueryString([
 *   { event: "lcp", page: "/", value: 2400 },
 *   { event: "cls", page: "/", value: 0.02 },
 * ]);
 * ```
 */
export function beaconQueryString(events: readonly BeaconEvent[]): string {
  const packed = events
    .map((event) => packEvent(event))
    .join(beaconEventSeparator);

  return (
    `${beaconParameters.version}=${String(beaconSchemaVersion)}` +
    `&${beaconParameters.events}=${encodeURIComponent(packed)}`
  );
}
