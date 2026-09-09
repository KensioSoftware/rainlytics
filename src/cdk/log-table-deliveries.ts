// Checking a table's deliveries against each other before it is built from
// them.
//
// One table describes one dataset. Several deliveries can write into it, and a
// bucket taking three sites' logs is what makes `distributionid` the first
// partition key. What they cannot do is disagree about what they are writing.
// A table built from the first of two deliveries that differ describes the
// other one wrongly, and the wrong description is the one that answers queries
// without complaining.

import type { PartitionGranularity } from "../partition-keys.js";
import type { LogDeliveryBucket } from "./delivery-bucket.js";
import type { LogOutputFormat } from "./log-delivery.js";

/**
 * What a table needs to know about a delivery writing into it.
 *
 * The six values a table is built from, and no construct. `LogTable` reads
 * these and nothing else, so a deployment whose delivery is declared in
 * another stack, another region or another account can describe what lands
 * in the bucket rather than holding the construct that put it there.
 *
 * `CloudFrontLogDelivery` satisfies this already, since it publishes all six
 * as readonly fields. A deployment holding the construct passes it and reads
 * nothing about this interface.
 *
 * Structural for the reason {@link LogDeliveryBucket} is. The narrower the
 * thing a table asks for, the more arrangements can answer it.
 *
 * ```typescript
 * new LogTable(this, "RainlyticsTable", {
 *   deliveries: [
 *     {
 *       distributionId: "E1EXAMPLE1234",
 *       logBucket: Bucket.fromBucketName(this, "Logs", "example-logs"),
 *       prefix: "rainlytics",
 *       outputFormat: "json",
 *       granularity: "hourly",
 *       fields: deliveredLogFieldNames,
 *     },
 *   ],
 * });
 * ```
 *
 * A description that does not match what CloudFront was actually configured
 * with produces the failure `LogTable` exists to avoid, and nothing here can
 * detect it. That is the cost of the arrangement, and `docs/log-table/` says
 * so. A deployment that can hold the construct should.
 */
export interface DeliveredLogs {
  /** The distribution whose logs these are, being a partition value. */
  readonly distributionId: string;

  /** The bucket they land in. */
  readonly logBucket: LogDeliveryBucket;

  /** The prefix inside it that the partitions start under. */
  readonly prefix: string;

  /** The format the objects are written in. */
  readonly outputFormat: LogOutputFormat;

  /** How finely they are partitioned by time. */
  readonly granularity: PartitionGranularity;

  /** The fields each record carries, in the order they are delivered. */
  readonly fields: readonly string[];
}

/**
 * The delivery the table is built from, once they have been checked against
 * each other.
 *
 * @throws {Error} where there is none, or where two of them describe
 *   different datasets.
 */
export function agreedDelivery(
  deliveries: readonly DeliveredLogs[],
): DeliveredLogs {
  const first = deliveries.at(0);

  if (first === undefined) {
    throw new Error(
      "A Rainlytics log table describes what a delivery writes, so it needs" +
        " at least one delivery to read.",
    );
  }

  for (const delivery of deliveries.slice(1)) {
    const difference = firstDifference(first, delivery);

    if (difference !== undefined) {
      throw new Error(
        `Deliveries for ${first.distributionId} and` +
          ` ${delivery.distributionId} disagree about ${difference}, so one` +
          ` table cannot describe both. Give each its own table, or bring` +
          ` the deliveries into step.`,
      );
    }
  }

  return first;
}

/** What two deliveries first disagree about, where they disagree at all. */
function firstDifference(
  one: DeliveredLogs,
  other: DeliveredLogs,
): string | undefined {
  const compared: Readonly<Record<string, readonly [string, string]>> = {
    "the log bucket": [one.logBucket.bucketName, other.logBucket.bucketName],
    "the prefix": [one.prefix, other.prefix],
    "the output format": [one.outputFormat, other.outputFormat],
    "the partition granularity": [one.granularity, other.granularity],
    "the field set": [one.fields.join(","), other.fields.join(",")],
  };

  return Object.entries(compared).find(
    ([, [mine, theirs]]) => mine !== theirs,
  )?.[0];
}
