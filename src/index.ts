// Rainlytics normalises what CloudFront, the load balancer, the application
// and the beacon each report into one event stream, and keeps it on S3 under
// Hive-style partitions.
//
// This module is the part both halves of the package share. Nothing here may
// reach for a Node built-in or for `aws-cdk-lib`, because browser code
// imports it too.

/**
 * The Hive-style S3 partition prefix covering an instant, in the form
 * `year=2026/month=08/day=05/hour=04`.
 *
 * Athena reads this dataset through partition projection rather than a
 * crawler, and projection matches partition values against a fixed format.
 * Every component is padded to a fixed width for that reason, including the
 * hours before ten.
 *
 * The components are UTC. A prefix built from local time would write two
 * different hours into one partition on the day the clocks go back.
 */
export function hivePartitionPrefix(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Cannot partition an invalid Date.");
  }

  return [
    `year=${pad(instant.getUTCFullYear(), 4)}`,
    `month=${pad(instant.getUTCMonth() + 1, 2)}`,
    `day=${pad(instant.getUTCDate(), 2)}`,
    `hour=${pad(instant.getUTCHours(), 2)}`,
  ].join("/");
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
