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

/**
 * What a projection needs to know about the dataset it covers.
 *
 * Two of the five keys take values that no rule can work out. The
 * distributions are whichever ones deliver into the bucket, and the first
 * year is whenever the first of them started.
 */
export interface PartitionProjectionScope {
  /** The earliest year the dataset holds. */
  readonly firstYear: number;

  /** Every distribution delivering into it. */
  readonly distributionIds: readonly string[];
}

/** A partition key, as the write side of the layout names it. */
export interface PartitionKey {
  /**
   * The Hive key name CloudFront writes for the variable below.
   *
   * AWS chooses this, and the choice of variable is the only influence we
   * have over it. The read side spells it out because a reader addresses the
   * finished prefix.
   */
  readonly name: string;

  /** The variable CloudFront substitutes when it writes the path. */
  readonly cloudFrontVariable: string;

  /**
   * How Athena projects this key's values, as the parameters a Glue table
   * carries under `projection.<name>.`.
   *
   * Declared with the key so that the write side and the read side of one
   * partition column stay in one place. A key added here arrives with the
   * projection that reads it, and a granularity that drops a key drops its
   * projection with it.
   */
  readonly projectionOf: (
    scope: PartitionProjectionScope,
  ) => Readonly<Record<string, string>>;
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
 * dataset Athena reads back as empty. The case of the variable carries into
 * the key CloudFront writes (`{DistributionId}` gives `DistributionId=`).
 *
 * No `valueAt`, because the distribution id comes from the caller rather than
 * from the instant being addressed.
 */
export const distributionKey: PartitionKey = {
  name: "distributionid",
  cloudFrontVariable: "{distributionid}",
  projectionOf: ({ distributionIds }) => ({
    type: "enum",
    values: distributionIds.join(","),
  }),
};

/**
 * The earliest year a projection covers where nobody says otherwise.
 *
 * The first Rainlytics delivery wrote its first object in 2026, so no dataset
 * this describes holds anything older.
 *
 * Deliberately a constant and not the current year. A synthesised template
 * that read the clock would change on 1 January, and the range it wrote would
 * start at the year of the most recent deploy. Every partition before that
 * would fall outside the projection, and Athena would answer from the
 * remainder without saying it had stopped reading the rest. A site whose logs
 * start later can shorten the range and save the planning work.
 */
export const defaultFirstPartitionYear = 2026;

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
    projectionOf: ({ firstYear }) => ({
      type: "date",
      range: `${String(firstYear)},NOW`,
      format: "yyyy",
      interval: "1",
      "interval.unit": "YEARS",
    }),
  },
  {
    name: "month",
    cloudFrontVariable: "{MM}",
    valueAt: (instant) => padded(instant.getUTCMonth() + 1, 2),
    projectionOf: () => ({ type: "integer", range: "1,12", digits: "2" }),
  },
  {
    name: "day",
    cloudFrontVariable: "{dd}",
    valueAt: (instant) => padded(instant.getUTCDate(), 2),
    projectionOf: () => ({ type: "integer", range: "1,31", digits: "2" }),
  },
  {
    name: "hour",
    cloudFrontVariable: "{HH}",
    valueAt: (instant) => padded(instant.getUTCHours(), 2),
    projectionOf: () => ({ type: "integer", range: "0,23", digits: "2" }),
  },
];

/** The time keys a granularity partitions by, coarsest first. */
export function timeKeysFor(
  granularity: PartitionGranularity,
): readonly TimePartitionKey[] {
  return granularity === "hourly" ? timeKeys : timeKeys.slice(0, 3);
}
