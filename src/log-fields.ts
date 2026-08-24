// Which CloudFront standard log fields Rainlytics asks for, and why each one
// is there.
//
// Fewer fields means smaller objects, less S3 storage and fewer bytes scanned
// by every query that ever runs over them. So this is the minimum the rollups
// need rather than everything CloudFront offers, and a field earns its place
// by having something that reads it.
//
// Field selection is set on the delivery, which has an
// UpdateDeliveryConfiguration operation, so this is a cheaper decision to
// revisit than the output format (which can only be set at creation). Confirm
// that before relying on it for anything expensive.

/**
 * The fields delivered, in the order they are delivered.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html
 */
export const deliveredLogFields = [
  // When, to the millisecond, in one field. `date` and `time` carry the same
  // thing in two.
  "timestamp(ms)",

  // Which site, where one distribution serves several names. Rollups are
  // per-site and nothing else in the record says which site this was.
  "x-host-header",

  // Separates the beacon's GET from everything else, and separates a HEAD
  // from a request a person made.
  "cs-method",

  // The path. Pageview rollups group by it.
  "cs-uri-stem",

  // The beacon's entire payload channel. CloudFront logs this whatever the
  // cache key and origin forwarding are set to, which is what lets layer 2
  // ride the access log rather than needing an endpoint of its own.
  "cs-uri-query",

  // Status code rollups, and the error rate.
  "sc-status",

  // Separates a pageview from a request for an image or a stylesheet, which
  // is a distinction the path alone cannot always make.
  "sc-content-type",

  // Referrer rollups.
  "cs(Referer)",

  // Device and browser rollups. Also the field that identifies most bots.
  "cs(User-Agent)",

  // Cache hit ratio.
  "x-edge-result-type",

  // Geography, already resolved by CloudFront from an address we then do not
  // have to store ourselves.
  "c-country",
] as const satisfies readonly string[];

/**
 * Fields deliberately left out, with the reason.
 *
 * Written down because "we never thought about it" and "we thought about it
 * and said no" look identical in a list that only holds what was chosen.
 *
 * - `c-ip` and `cs(Cookie)` are personal data. An access log without them is
 *   a record of requests, and with them it is a record of people. Leaving
 *   `c-ip` out also means there is no unique-visitor count, which is a real
 *   loss and a decision for whoever runs the site. See the note in
 *   `.claude/roadmap.md`.
 * - `time-taken`, `origin-fbl` and `origin-lbl` measure the origin. Nothing
 *   rolls them up yet, and Core Web Vitals come from the beacon.
 * - `viewer-request-log-data` carries `cf.logCustomData()` output, capped at
 *   800 bytes. The beacon uses the query string, which holds far more.
 * - `x-edge-location`, `asn`, `ssl-*`, `fle-*`, `c-port`, `sc-range-*`,
 *   `x-forwarded-for` and `cs-protocol*` have no reader.
 */
export const omittedLogFields = [
  "c-ip",
  "cs(Cookie)",
  "time-taken",
  "origin-fbl",
  "origin-lbl",
  "viewer-request-log-data",
] as const satisfies readonly string[];

/**
 * Every field name CloudFront standard logging v2 accepts.
 *
 * Here so that a typo in the list above fails a test rather than a deployment,
 * or worse, delivers a dataset with a column permanently missing from it.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging.html
 */
export const availableLogFields: readonly string[] = [
  // The standard access log fields.
  "date",
  "time",
  "x-edge-location",
  "sc-bytes",
  "c-ip",
  "cs-method",
  "cs(Host)",
  "cs-uri-stem",
  "sc-status",
  "cs(Referer)",
  "cs(User-Agent)",
  "cs-uri-query",
  "cs(Cookie)",
  "x-edge-result-type",
  "x-edge-request-id",
  "x-host-header",
  "cs-protocol",
  "cs-bytes",
  "time-taken",
  "x-forwarded-for",
  "ssl-protocol",
  "ssl-cipher",
  "x-edge-response-result-type",
  "cs-protocol-version",
  "fle-status",
  "fle-encrypted-fields",
  "c-port",
  "time-to-first-byte",
  "x-edge-detailed-result-type",
  "sc-content-type",
  "sc-content-len",
  "sc-range-start",
  "sc-range-end",
  "c-country",
  "cache-behavior-path-pattern",
  // The real-time fields standard logging v2 also offers.
  "timestamp(ms)",
  "origin-fbl",
  "origin-lbl",
  "asn",
  "viewer-request-log-data",
  "viewer-response-log-data",
];
