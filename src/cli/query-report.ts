// What a query cost and where it ran, said on standard error.
//
// The price of an ad-hoc question is the thing this project is organised
// around, and it is invisible everywhere else. Athena reports it after the
// fact, on a bill that arrives weeks later and names a month's total rather
// than the query that made it. Putting it in front of whoever just ran one
// is the cheapest moment it can be seen.
//
// Standard error, so a pipeline reads rows and never prose.

import {
  bytesBilledFor,
  bytesBilledMinimum,
  queryChargeInDollars,
} from "../athena-pricing.js";
import type { AthenaOutcome } from "./athena-outcome.js";

/**
 * Where one query ran, for standard error.
 *
 * The execution id is what finds it again in the console. The workgroup and
 * the region are the two things a query has to be right about, and one of
 * them is usually wrong behind an answer of zero rows. Where the chain
 * resolved no region, the line names the workgroup alone.
 */
export function whereItRan(
  outcome: Pick<AthenaOutcome, "queryExecutionId" | "region">,
  workgroup: string,
): string {
  const region = outcome.region === undefined ? "" : ` in ${outcome.region}`;

  return (
    `Query ${outcome.queryExecutionId} ran in workgroup` +
    ` ${workgroup}${region}.\n`
  );
}

const byteUnits = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A byte count as a person reads one.
 *
 * Decimal units, matching the ones AWS prices and reports in.
 */
export function inBytes(bytes: number): string {
  const power = Math.min(
    byteUnits.length - 1,
    bytes === 0 ? 0 : Math.floor(Math.log10(bytes) / 3),
  );
  const scaled = bytes / 1000 ** power;
  const unit = byteUnits[power] ?? "B";

  return power === 0
    ? `${String(bytes)} ${unit}`
    : `${scaled.toFixed(scaled < 10 ? 2 : 1)} ${unit}`;
}

/**
 * A charge as a person reads one.
 *
 * Two decimal places once there is a cent to see, and two significant figures
 * below that. A query costing $0.000050 should say so rather than round to
 * nothing, since a reader deciding whether to run it again wants the order of
 * magnitude.
 */
export function inDollars(dollars: number): string {
  return dollars >= 0.01
    ? `$${dollars.toFixed(2)}`
    : `$${dollars.toPrecision(2)}`;
}

/**
 * What one query scanned and what that comes to, for standard error.
 *
 * A query Athena charges for is priced. A failed one is not, since
 * [Athena's pricing](https://aws.amazon.com/athena/pricing/) lists failed
 * queries among what it does not bill for, and quoting a figure for one would
 * be inventing a charge. What it read is reported either way, because a query
 * that scanned a lot before giving up is worth knowing about.
 */
export function scanReport(
  bytesScanned: number,
  milliseconds: number | undefined,
  isCharged = true,
): string {
  const took =
    milliseconds === undefined
      ? ""
      : ` in ${(milliseconds / 1000).toFixed(1)}s`;

  return `Scanned ${inBytes(bytesScanned)}${took}${
    isCharged
      ? chargeFor(bytesScanned)
      : ". Athena does not charge for a query that failed."
  }\n`;
}

/** The rest of the line, for a query that will be billed. */
function chargeFor(bytesScanned: number): string {
  const minimum =
    bytesBilledFor(bytesScanned) > bytesScanned &&
    bytesScanned < bytesBilledMinimum
      ? `, billed as ${inBytes(bytesBilledMinimum)} (the per-query minimum)`
      : "";

  return (
    `${minimum}. About ${inDollars(queryChargeInDollars(bytesScanned))}` +
    ` at the us-east-1 rate.`
  );
}
