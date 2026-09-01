// What reading a report cost and how old the S3 object is.

import { inDollars } from "./query-report.js";
import type { ReportRead } from "./report-lookup.js";
import { getChargeInDollars, howLongBefore } from "./summary-freshness.js";

/** The report read diagnostic written to standard error. */
export function reportReadReport(read: ReportRead, at: Date): string {
  const modifiedAt = read.lastModified.toISOString();

  return (
    `Read the ${read.document.period.unit} report starting` +
    ` ${read.document.period.startsOn} from ${read.bucket} at ${read.key}.\n` +
    `The object was last modified ${modifiedAt}` +
    ` (${howLongBefore(modifiedAt, at)} ago). 1 GET, about` +
    ` ${inDollars(getChargeInDollars(1))} at the us-east-1 rate.\n`
  );
}

/** The diagnostic for the two S3 objects behind a report comparison. */
export function reportComparisonReadReport(
  current: ReportRead,
  previous: ReportRead,
  at: Date,
): string {
  const currentModified = current.lastModified.toISOString();
  const previousModified = previous.lastModified.toISOString();

  return (
    `Compared the ${current.document.period.unit} report starting` +
    ` ${current.document.period.startsOn} with the one starting` +
    ` ${previous.document.period.startsOn} in ${current.bucket}.\n` +
    `Current object ${current.key}, last modified ${currentModified}` +
    ` (${howLongBefore(currentModified, at)} ago).\n` +
    `Previous object ${previous.key}, last modified ${previousModified}` +
    ` (${howLongBefore(previousModified, at)} ago). 2 GETs, about` +
    ` ${inDollars(getChargeInDollars(2))} at the us-east-1 rate.\n`
  );
}
