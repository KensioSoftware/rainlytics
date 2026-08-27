// What one query is allowed to cost, and where the numbers come from.
//
// Athena is priced per byte scanned, so a query that reads the whole dataset
// bills for the whole dataset. The first sign of one is the bill, which
// arrives weeks later and names a total rather than the query that caused it.
// A workgroup cutoff turns that into a failure at the moment the query is
// run, naming the limit.

import { Duration, Size } from "aws-cdk-lib/core";

/**
 * What Athena charges for a query, per byte scanned.
 *
 * $5.00 per terabyte in us-east-1, read from the AWS Pricing API on
 * 2026-08-27 (`AmazonAthena`, `USE1-DataScannedInTB`, effective 2026-03-01).
 * Other regions differ, and this is here to make the arithmetic below
 * checkable rather than to price anybody's bill.
 */
export const dollarsPerTerabyteScanned = 5;

/**
 * The smallest cutoff Athena accepts, which is also its minimum billing unit.
 *
 * The same Pricing API entry describes the charge as "total data scanned per
 * query with a minimum 10MB for each successful or cancelled queries". Every
 * query therefore bills for at least this much whatever it reads, and Athena
 * refuses a workgroup cutoff below it.
 *
 * Ten million bytes rather than ten mebibytes. AWS writes the floor as 10MB
 * and a cutoff between the two spellings is legal, so the check uses the
 * lower one and refuses nothing Athena would take.
 */
export const smallestBytesScannedCutoff = Size.bytes(10_000_000);

/**
 * How much one query may scan where nobody chooses otherwise.
 *
 * Ten gibibytes, which caps a single query at about five cents. The figure
 * comes from the far end of what a legitimate query reads rather than from
 * what a mistake costs.
 *
 * KensioSoftware/rainlytics#9 measured a site serving 156,000 requests a day
 * at 4.42MB of gzipped logs a day, so its raw store levels off around 1.6GB
 * under the 365-day expiry. A rollup reading the whole of that year, which is
 * the widest query the pipeline has any reason to run, scans well under a
 * fifth of this. Six years of that site, or one year of a site six times
 * busier, is the headroom.
 *
 * So a query that hits this has gone wrong rather than grown into it. It is a
 * ceiling on one mistake and not a correctness check: a full scan of a small
 * dataset stays under it and costs a fraction of a cent, which is the right
 * answer for a person asking an ad-hoc question.
 *
 * Raise it deliberately on a busy site. Lower it on a quiet one, where the
 * whole dataset is small enough that a cutoff near its size catches an
 * unpartitioned query as well as an expensive one.
 */
export const defaultBytesScannedCutoff = Size.gibibytes(10);

/**
 * How long a query's results are kept on S3 before they expire.
 *
 * Athena writes one object per query and never reads it again. Nothing in
 * Rainlytics does either: the command line reads a result once, as the query
 * it just ran finishes, and the rollups write their own summaries elsewhere.
 * So this window is for a person going back to something they ran earlier in
 * the week, and a week is what it is sized for.
 *
 * Results are also the one copy of query output that leaves the raw store, so
 * keeping them indefinitely grows a bucket nobody is watching.
 */
export const defaultResultsRetention = Duration.days(7);

/**
 * @throws {Error} for a cutoff Athena would refuse.
 */
export function assertUsableCutoff(cutoff: Size): void {
  if (cutoff.toBytes() < smallestBytesScannedCutoff.toBytes()) {
    throw new Error(
      `A bytes-scanned cutoff of ${String(cutoff.toBytes())} bytes is below` +
        ` the ${String(smallestBytesScannedCutoff.toBytes())} Athena accepts.` +
        ` Every query bills for that much whatever it reads, so a cutoff` +
        ` under it would refuse every query.`,
    );
  }
}
