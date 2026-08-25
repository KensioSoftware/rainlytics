// The shape of the log dataset on S3, rendered for the two halves that have
// to agree about it: the CloudFront delivery that writes the partitions, and
// the Athena table that reads them back.
//
// Out of step, this fails quietly. CloudFront writes under a prefix nothing
// queries and Athena reads a prefix nothing writes, and both halves look
// healthy from where they stand. So both renderings below come from the keys
// in `partition-keys.ts` rather than from two string literals that happen to
// match today.
//
// The two renderings look different, and that is deliberate. The write side
// names CloudFront's variables and stops there, because CloudFront applies
// the `key=` half of each segment itself when the delivery is
// Hive-compatible. The read side spells the whole `key=value` pair out. They
// agree through AWS's substitution. Squaring them up by hand would put
// `year=year=2026` on S3, and CloudWatch Logs refuses the delivery long
// before it gets that far.

import {
  defaultPartitionGranularity,
  distributionKey,
  type PartitionGranularity,
  timeKeysFor,
} from "./partition-keys.js";

/** The time keys a granularity partitions by, coarsest first. */
export function timePartitionKeyNames(
  granularity: PartitionGranularity = defaultPartitionGranularity,
): readonly string[] {
  return timeKeysFor(granularity).map((key) => key.name);
}

/**
 * The `suffixPath` CloudFront writes under, being the bare partition
 * variables.
 *
 * CloudFront supplies the `key=` half of each segment when the delivery
 * carries the Hive-compatible option, turning `{yyyy}` into `year=2026` and
 * `{distributionid}` into `distributionid=E1EXAMPLE1234`. Naming those keys
 * here as well is what CloudWatch Logs refuses, with "Provided suffixPath is
 * invalid".
 *
 * AWS documents that substitution twice and the two readings pull opposite
 * ways. The "Example paths to access logs" tables carry a column for what
 * you specify and a column for where the logs land (`myFolderA/{yyyy}` in,
 * `myFolderA/year=2025` out). The "Hive-compatible file name format" example
 * a few paragraphs above them prints `year={yyyy}` inside a path. That
 * example is output after substitution, and it is the one anyone
 * rederiving this finds first.
 */
export function deliverySuffixPath(
  granularity: PartitionGranularity = defaultPartitionGranularity,
): string {
  return [distributionKey, ...timeKeysFor(granularity)]
    .map((key) => key.cloudFrontVariable)
    .join("/");
}

/** Which partition an instant belongs to. */
export interface PartitionAddress {
  /** The CloudFront distribution the logs came from. */
  readonly distributionId: string;

  /** An instant inside the partition being addressed. */
  readonly at: Date;
}

/**
 * The prefix holding the logs for one instant, as a reader addresses it.
 *
 * The same keys in the same order as the variables in
 * {@link deliverySuffixPath}, with the values filled in and the `key=` half
 * written out. CloudFront writes those same pairs from those variables.
 *
 * @throws {RangeError} when the instant is an invalid Date, rather than
 *   addressing a `year=NaN` prefix every later query silently misses.
 */
export function partitionPrefix(
  address: PartitionAddress,
  granularity: PartitionGranularity = defaultPartitionGranularity,
): string {
  if (Number.isNaN(address.at.getTime())) {
    throw new RangeError("Cannot address a partition for an invalid Date.");
  }

  const time = timeKeysFor(granularity).map(
    (key) => `${key.name}=${key.valueAt(address.at)}`,
  );

  return [`${distributionKey.name}=${address.distributionId}`, ...time].join(
    "/",
  );
}
