// The shape of the log dataset on S3, rendered for the two halves that have
// to agree about it: the CloudFront delivery that writes the partitions, and
// the Athena table that reads them back.
//
// Out of step, this fails quietly. CloudFront writes under a prefix nothing
// queries and Athena reads a prefix nothing writes, and both halves look
// healthy from where they stand. So every rendering below comes from the keys
// in `partition-keys.ts` rather than from string literals that happen to
// match today.
//
// The renderings look different, and that is deliberate. The write side
// names CloudFront's variables and stops there, because CloudFront applies
// the `key=` half of each segment itself when the delivery is
// Hive-compatible. The read side spells the whole `key=value` pair out. They
// agree through AWS's substitution. Squaring them up by hand would put
// `year=year=2026` on S3, and CloudWatch Logs refuses the delivery long
// before it gets that far.
//
// The read side has two forms of its own. A reader addressing one partition
// fills the values in. An Athena table leaves Athena's `${key}` placeholder
// where each value goes and lets the projection supply it.

import {
  defaultPartitionGranularity,
  distributionKey,
  type PartitionGranularity,
  type PartitionProjectionScope,
  timeKeysFor,
} from "./partition-keys.js";

/** The time keys a granularity partitions by, coarsest first. */
export function timePartitionKeyNames(
  granularity: PartitionGranularity = defaultPartitionGranularity,
): readonly string[] {
  return timeKeysFor(granularity).map((key) => key.name);
}

/** Every partition key name, the distribution first and then time. */
export function partitionKeyNames(
  granularity: PartitionGranularity = defaultPartitionGranularity,
): readonly string[] {
  return [distributionKey.name, ...timePartitionKeyNames(granularity)];
}

/**
 * The `storage.location.template` an Athena table projects its partitions
 * under, relative to the prefix the delivery writes into.
 *
 * The third rendering of the layout, and the one Athena reads. It spells out
 * the same `key=value` pairs {@link partitionPrefix} does, with Athena's
 * `${key}` placeholder where the value goes. Athena substitutes those from
 * the projected values of each column.
 *
 * A table could leave this out. Athena then assembles the same path from the
 * partition keys in the order the table declares them, which is the Hive
 * layout CloudFront writes. Declaring it says where the data is rather than
 * relying on two orderings staying in step, and it is what the projection
 * documentation recommends.
 */
export function partitionLocationTemplate(
  granularity: PartitionGranularity = defaultPartitionGranularity,
): string {
  return partitionKeyNames(granularity)
    .map((name) => `${name}=\${${name}}`)
    .join("/");
}

/**
 * The Glue table parameters that project these partitions, rather than
 * registering them.
 *
 * A projected partition is worked out from the query. Athena expands each
 * column's declared values, narrows them by the `WHERE` clause, and reads the
 * prefixes that survive. Nothing enumerates S3 and no partition is ever
 * stored, which is what keeps a Glue crawler and its schedule out of the
 * pipeline.
 *
 * The cost of that is exactness. Athena matches a projected value against the
 * key on S3 character for character, so `hour=4` misses a partition written
 * `hour=04`. Every value the write side pads, the read side pads the same
 * way, and both paddings come from the one declaration in
 * `partition-keys.ts`.
 */
export function partitionProjection(
  scope: PartitionProjectionScope,
  granularity: PartitionGranularity = defaultPartitionGranularity,
): Readonly<Record<string, string>> {
  const parameters: Record<string, string> = { "projection.enabled": "true" };

  for (const key of [distributionKey, ...timeKeysFor(granularity)]) {
    for (const [suffix, value] of Object.entries(key.projectionOf(scope))) {
      parameters[`projection.${key.name}.${suffix}`] = value;
    }
  }

  return parameters;
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
