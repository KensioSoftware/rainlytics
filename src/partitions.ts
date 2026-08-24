// The shape of the log dataset on S3, rendered for the two halves that have
// to agree about it: the CloudFront delivery that writes the partitions, and
// the Athena table that reads them back.
//
// Out of step, this fails quietly. CloudFront writes under a prefix nothing
// queries and Athena reads a prefix nothing writes, and both halves look
// healthy from where they stand. So both renderings below come from the keys
// in `partition-keys.ts` rather than from two string literals that happen to
// match today.

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
 * The `suffixPath` CloudFront writes under, with its variables left in for
 * CloudFront to substitute.
 *
 * Goes on the delivery alongside the Hive-compatible option, which is what
 * makes the `key=value` segments here mean anything to Athena.
 */
export function deliverySuffixPath(
  granularity: PartitionGranularity = defaultPartitionGranularity,
): string {
  return [distributionKey, ...timeKeysFor(granularity)]
    .map((key) => `${key.name}=${key.cloudFrontVariable}`)
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
 * The same keys in the same order as {@link deliverySuffixPath}, with values
 * filled in rather than left as CloudFront variables.
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
