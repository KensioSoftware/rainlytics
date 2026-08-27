// What Athena charges for a query, and what that makes one cost.
//
// Shared, because two halves of Rainlytics reason about the same number. The
// workgroup's bytes-scanned cutoff is justified from it, and the command line
// prices a query with it at the moment somebody runs one. A cost this project
// is organised around should not be spelled out twice.
//
// Nothing here reaches for the AWS SDK or for CDK. It is arithmetic over
// figures read off the AWS Pricing API.

/**
 * What Athena charges per terabyte scanned.
 *
 * $5.00 in us-east-1, read from the AWS Pricing API on 2026-08-27
 * (`AmazonAthena`, `USE1-DataScannedInTB`, effective 2026-03-01). Other
 * regions differ. Re-check it before quoting it at anybody.
 */
export const dollarsPerTerabyteScanned = 5;

/**
 * The bytes in the terabyte that price is per.
 *
 * A decimal terabyte. AWS writes "per TB" without saying which, and its
 * storage pricing means the binary one. Taking the smaller unit here makes
 * every figure this module reports about 9% higher than the binary reading
 * would, and overstating what a query cost is the safer direction for a
 * number somebody is deciding against.
 */
const bytesPerTerabyte = 1_000_000_000_000;

/**
 * The least Athena bills for one query, whatever it read.
 *
 * Ten million bytes. The same Pricing API entry describes the charge as
 * "total data scanned per query with a minimum 10MB for each successful or
 * cancelled queries", which is also the floor Athena puts under a workgroup's
 * bytes-scanned cutoff.
 */
export const bytesBilledMinimum = 10_000_000;

/**
 * The megabyte a scan is rounded up to before it is charged.
 *
 * [Athena's pricing page](https://aws.amazon.com/athena/pricing/) says the
 * bytes a query scans are "rounded up to the nearest megabyte". The Pricing
 * API entry the rate above comes from mentions only the minimum, so this half
 * is taken from the page rather than the API.
 *
 * Decimal, matching the terabyte above. Rounding up is also the direction
 * that overstates rather than understates.
 */
const bytesPerMegabyte = 1_000_000;

/**
 * What one query is billed for having scanned.
 *
 * Rounded up to the next megabyte, and then held to the minimum. A query
 * reading a single small object therefore costs the same as one reading ten
 * megabytes.
 */
export function bytesBilledFor(bytesScanned: number): number {
  return Math.max(
    Math.ceil(bytesScanned / bytesPerMegabyte) * bytesPerMegabyte,
    bytesBilledMinimum,
  );
}

/**
 * What one query cost, in dollars, at the us-east-1 rate.
 *
 * An estimate rather than a bill, and whatever quotes it should say which
 * rate it used. Every region charges its own, and resolving the caller's
 * would mean either shipping a price list that goes stale without saying so
 * or a Pricing API call before every query. Naming the assumption costs four
 * words and cannot rot.
 */
export function queryChargeInDollars(bytesScanned: number): number {
  return (
    (bytesBilledFor(bytesScanned) / bytesPerTerabyte) *
    dollarsPerTerabyteScanned
  );
}
