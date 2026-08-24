// The partition keys themselves, apart from the two renderings of them in
// `partitions.ts`. This is the single definition those two agree through.

/** How finely the dataset is partitioned by time. */
export type PartitionGranularity = "hourly" | "daily";

/**
 * The granularity used where a caller expresses no preference.
 *
 * Hourly, which is the choice that keeps the most open. Granularity has no
 * bearing on how many objects land or how big they are, since CloudFront
 * decides when to cut a file whatever prefix it writes under. What it decides
 * is how precisely a query prunes, and whether a rollup can read one hour
 * without rereading the hours before it.
 *
 * Daily forecloses that. An hourly rollup over daily partitions rereads a
 * growing day every time it runs. Hourly forecloses nothing, because a daily
 * rollup over hourly partitions reads twenty-four of them and Athena prunes
 * them with no metadata store to consult. Hourly also aggregates up to daily
 * later, where daily never divides back down.
 *
 * The cost of hourly is a fourth projected column, and more partitions to
 * enumerate on a query naming no hour. That is planning time, not bytes
 * scanned.
 *
 * Revisit once KensioSoftware/rainlytics#9 has measured a real distribution.
 */
export const defaultPartitionGranularity: PartitionGranularity = "hourly";

/** A partition key, as the write side of the layout names it. */
export interface PartitionKey {
  /** The Hive key name, lowercase because Glue expects lowercase. */
  readonly name: string;

  /** The variable CloudFront substitutes when it writes the path. */
  readonly cloudFrontVariable: string;
}

/** A partition key whose value a reader can work out from an instant. */
export interface TimePartitionKey extends PartitionKey {
  /** The same value worked out here, for addressing a partition to read. */
  readonly valueAt: (instant: Date) => string;
}

function padded(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * The distribution the request reached, which partitions before time does.
 *
 * Lowercase in both halves. CloudFront offers `{DistributionId}` as well, and
 * Glue expects partition names in lowercase, so the other spelling produces a
 * dataset Athena reads back as empty.
 *
 * No `valueAt`, because the distribution id comes from the caller rather than
 * from the instant being addressed.
 */
export const distributionKey: PartitionKey = {
  name: "distributionid",
  cloudFrontVariable: "{distributionid}",
};

/**
 * The time keys, coarsest first.
 *
 * Every component is padded to a fixed width and every one is UTC. Partition
 * projection matches values against a fixed format, so an hour before ten has
 * to arrive as `hour=04`. UTC because a local-time prefix writes two
 * different hours into one partition on the day the clocks go back.
 */
const timeKeys: readonly TimePartitionKey[] = [
  {
    name: "year",
    cloudFrontVariable: "{yyyy}",
    valueAt: (instant) => padded(instant.getUTCFullYear(), 4),
  },
  {
    name: "month",
    cloudFrontVariable: "{MM}",
    valueAt: (instant) => padded(instant.getUTCMonth() + 1, 2),
  },
  {
    name: "day",
    cloudFrontVariable: "{dd}",
    valueAt: (instant) => padded(instant.getUTCDate(), 2),
  },
  {
    name: "hour",
    cloudFrontVariable: "{HH}",
    valueAt: (instant) => padded(instant.getUTCHours(), 2),
  },
];

/** The time keys a granularity partitions by, coarsest first. */
export function timeKeysFor(
  granularity: PartitionGranularity,
): readonly TimePartitionKey[] {
  return granularity === "hourly" ? timeKeys : timeKeys.slice(0, 3);
}
