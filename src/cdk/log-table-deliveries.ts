// Checking a table's deliveries against each other before it is built from
// them.
//
// One table describes one dataset. Several deliveries can write into it, and a
// bucket taking three sites' logs is what makes `distributionid` the first
// partition key. What they cannot do is disagree about what they are writing.
// A table built from the first of two deliveries that differ describes the
// other one wrongly, and the wrong description is the one that answers queries
// without complaining.

import type { CloudFrontLogDelivery } from "./log-delivery.js";

/**
 * The delivery the table is built from, once they have been checked against
 * each other.
 *
 * @throws {Error} where there is none, or where two of them describe
 *   different datasets.
 */
export function agreedDelivery(
  deliveries: readonly CloudFrontLogDelivery[],
): CloudFrontLogDelivery {
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
  one: CloudFrontLogDelivery,
  other: CloudFrontLogDelivery,
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
