// Which CloudFront standard log fields Rainlytics asks for, and what reads
// each one.
//
// Every field costs S3 storage for as long as the logs are kept, and costs
// scanned bytes on every query that ever runs over them. Neither cost is
// recoverable, because the raw store is immutable and keeps whatever was
// delivered into it. So a field earns its place by naming the thing that
// reads it, and `readBy` below is that name rather than a comment, so a test
// can insist on it.
//
// One of them is the viewer's address. `c-ip` is delivered so a visitor
// count can be computed from it (KensioSoftware/rainlytics#53). The raw
// store is therefore a record of people, and the log bucket's expiry decides
// how long that lasts. `cdk/log-lifecycle.ts` holds that decision.
//
// Field selection is set on the delivery, which has an
// UpdateDeliveryConfiguration operation, so this is cheaper to revisit than
// the output format (which can only be set at creation). Confirm that before
// relying on it for anything expensive.

/** A field Rainlytics asks CloudFront to deliver. */
export interface DeliveredLogField {
  /** The field name, spelled as CloudFront spells it. */
  readonly name: string;

  /**
   * The name a Parquet delivery writes this field under.
   *
   * AWS mangles it. Every run of characters outside `[A-Za-z0-9]` becomes one
   * underscore and a trailing underscore is dropped, so `cs(Referer)` is
   * written `cs_Referer` and `timestamp(ms)` is written `timestamp_ms`. Case
   * survives. A JSON delivery keeps CloudFront's own spelling, and
   * KensioSoftware/rainlytics#9 read both back off S3 to confirm it.
   *
   * Declared per field rather than computed. The rule above is inferred from
   * eleven observations of a transformation AWS documents nowhere, and a
   * field that broke it would reach Athena as a column of nulls over a
   * query reporting success. `log-fields.test.ts` applies the rule to every
   * declared name here, so the two disagree in a test rather than in a
   * dataset.
   */
  readonly parquetName: string;

  /**
   * What reads this field.
   *
   * A sentence rather than a word. Adding a field is a decision that costs
   * money for as long as the logs exist, and writing down who wants it is the
   * cheapest moment to notice that nobody does.
   */
  readonly readBy: string;
}

/**
 * The fields delivered, in the order they are delivered.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html
 */
export const deliveredLogFields: readonly DeliveredLogField[] = [
  {
    name: "timestamp(ms)",
    parquetName: "timestamp_ms",
    readBy:
      "Every rollup, as the time axis. One field where `date` and `time`" +
      " carry the same thing in two.",
  },
  {
    name: "x-host-header",
    parquetName: "x_host_header",
    readBy:
      "Per-site rollups, where one distribution serves several names." +
      " Nothing else in the record says which site was asked for.",
  },
  {
    name: "cs-method",
    parquetName: "cs_method",
    readBy:
      "Filtering, to separate the beacon's GET from a HEAD and from" +
      " anything a person did not ask for.",
  },
  {
    name: "cs-uri-stem",
    parquetName: "cs_uri_stem",
    readBy: "The pageviews-by-path rollup, which groups by exactly this.",
  },
  {
    name: "cs-uri-query",
    parquetName: "cs_uri_query",
    readBy:
      "The layer-2 beacon, whose entire payload arrives here. CloudFront" +
      " logs it whatever the cache key and origin forwarding are set to.",
  },
  {
    name: "sc-status",
    parquetName: "sc_status",
    readBy: "The status code rollup, and the error rate derived from it.",
  },
  {
    name: "sc-content-type",
    parquetName: "sc_content_type",
    readBy:
      "Separating a pageview from a request for an image or a stylesheet," +
      " which the path alone cannot always do.",
  },
  {
    name: "cs(Referer)",
    parquetName: "cs_Referer",
    readBy:
      "The referrer rollup, which is the only account of how anybody" +
      " arrived that a server-side log can give.",
  },
  {
    name: "cs(User-Agent)",
    parquetName: "cs_User_Agent",
    readBy:
      "The device and browser rollup, and the bot filtering every other" +
      " rollup depends on.",
  },
  {
    name: "x-edge-result-type",
    parquetName: "x_edge_result_type",
    readBy:
      "The cache hit ratio, and separating a request CloudFront served" +
      " from one that reached the origin.",
  },
  {
    name: "c-country",
    parquetName: "c_country",
    readBy:
      "The geography rollup, which CloudFront resolves from the address" +
      " itself. No query has to do a lookup of its own.",
  },
  /*
   * Last in the list, and it stays last.
   *
   * A delivery change applies to what CloudFront writes from then on and
   * rewrites nothing already in the bucket, so the dataset holds records of
   * both shapes for ever. Appending a column leaves every earlier record
   * readable and the new one null on the days before the change. Inserting
   * one in CloudFront's own field order would put a new name in the middle
   * of the table's columns, and a `SELECT *` would answer in an order that
   * depends on when the object was written.
   *
   * This is also the first field whose Parquet name is predicted by the rule
   * in `parquetName` above rather than read off a delivered object. `c_ip` is
   * the least surprising name the rule produces, and a Parquet delivery that
   * spells it some other way reaches Athena as a column of nulls under a
   * query reporting success. Read one back before trusting a visitor count
   * over Parquet.
   */
  {
    name: "c-ip",
    parquetName: "c_ip",
    readBy:
      "The unique visitor count. KensioSoftware/rainlytics#74 hashes this" +
      " and the user agent under a salt that rotates daily, and nothing" +
      " else in a record identifies a viewer.",
  },
];

/** The delivered field names, which is what a delivery is configured with. */
export const deliveredLogFieldNames: readonly string[] = deliveredLogFields.map(
  (field) => field.name,
);

/**
 * The Glue column name a field is read back through, whichever format the
 * delivery writes.
 *
 * Athena stores every column name in lowercase
 * ([naming rules](https://docs.aws.amazon.com/athena/latest/ug/tables-databases-columns-names.html)),
 * so this is the Parquet spelling with the case taken off. Both output
 * formats reach it. Athena's Parquet reader falls back to a case-insensitive
 * match, which finds `cs_Referer` in the file from a `cs_referer` column. A
 * JSON table carries `mapping.cs_referer` in its SerDe parameters, pointing
 * the same column at `cs(Referer)` in the record.
 *
 * One set of column names for both formats is what lets a rollup query be
 * written once. The alternative is SQL that has to know how the bytes under
 * it were written.
 */
export function logColumnName(field: DeliveredLogField): string {
  return field.parquetName.toLowerCase();
}

/** The Glue column names, in the order the fields are delivered. */
export const deliveredLogColumnNames: readonly string[] =
  deliveredLogFields.map((field) => logColumnName(field));

/**
 * The declared fields going by these names, in the order asked for.
 *
 * A table is built from the fields a delivery was configured with, and a
 * field this list has never heard of has no Parquet spelling and no reader.
 * Guessing one from the rule in {@link DeliveredLogField.parquetName} would
 * put a column of nulls in a table that queries successfully, so this refuses
 * instead.
 *
 * @throws {Error} for a name Rainlytics does not declare.
 */
export function deliveredLogFieldsNamed(
  names: readonly string[],
): readonly DeliveredLogField[] {
  return names.map((name) => {
    const field = deliveredLogFields.find((declared) => declared.name === name);

    if (field === undefined) {
      throw new Error(
        `Log field "${name}" is not one Rainlytics declares, so no column can` +
          ` be built for it. Add it to deliveredLogFields in src/log-fields.ts,` +
          ` with the name a Parquet delivery writes it under.`,
      );
    }

    return field;
  });
}

/**
 * Fields deliberately left out, with the reason.
 *
 * Written down because "we never thought about it" and "we thought about it
 * and said no" look identical in a list holding only what was chosen.
 *
 * `c-ip` was on this list until KensioSoftware/rainlytics#53 chose the
 * daily-rotating hash. It is delivered now, and the raw store holds viewer
 * addresses for as long as it holds anything. `cdk/log-lifecycle.ts` carries
 * the retention that decision landed on.
 *
 * - `cs(Cookie)` is personal data with nothing to read it. The visitor
 *   identifier comes from the address, and a cookie would only be a second
 *   way to recognise the same person.
 * - `time-taken`, `origin-fbl` and `origin-lbl` measure the origin. Nothing
 *   rolls them up yet, and Core Web Vitals come from the beacon.
 * - `viewer-request-log-data` carries `cf.logCustomData()` output, capped at
 *   800 bytes. The beacon uses the query string, which holds far more.
 * - `x-forwarded-for` holds the address of the viewer where `c-ip` holds the
 *   address of the proxy in front of them. It would sharpen the count for
 *   viewers behind one, and cost a field on every record where most of them
 *   carry a hyphen. Worth revisiting once there is a count to measure it
 *   against.
 * - `x-edge-location`, `asn`, `ssl-*`, `fle-*`, `c-port`, `sc-range-*` and
 *   `cs-protocol*` have no reader.
 */
export const omittedLogFields: readonly string[] = [
  "cs(Cookie)",
  "x-forwarded-for",
  "time-taken",
  "origin-fbl",
  "origin-lbl",
  "viewer-request-log-data",
];

/**
 * Every field name CloudFront standard logging v2 accepts.
 *
 * Here so a typo in the lists above fails a test rather than a deployment,
 * or worse, delivers a dataset with a column permanently missing from it.
 *
 * It is also the ceiling on how many fields one delivery can carry. Neither
 * the CloudFront quotas page nor the CloudWatch Logs one publishes any limit
 * on `recordFields`, and the `CreateDelivery` example in the CloudFront
 * documentation prints a delivery holding every standard access log field at
 * once. So the twelve above sit a long way inside what AWS will accept, and
 * what keeps the list short is the storage and the bytes each query scans.
 * Read in August 2026, and worth reading again before adding several.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging.html
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html
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
