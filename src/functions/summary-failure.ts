// What the job does about a query Athena would not finish.
//
// Nobody is watching when a scheduled run fails. A person running
// `rainlytics pageviews` reads the reason on their terminal, and this reason
// goes into a log group and onto the function's error metric. Both are places
// somebody has to go and look, so the message has to explain itself to a
// reader arriving cold and days late.

import type { AthenaOutcome } from "../athena/athena-outcome.js";

/**
 * The failure a run reports for a query that did not succeed.
 *
 * The bytes-scanned cutoff gets its own paragraph. It is the one limit this
 * pipeline sets deliberately, and a scheduled job meets it in a way a person
 * never does: the table grows under a query nobody has touched since the day
 * it was deployed, and one morning the run that worked yesterday stops. The
 * reason Athena gives reads as a wall, and the paragraph says who put it
 * there and where it is set.
 *
 * Matched on the reason text, which is the only signal Athena gives. A cutoff
 * refusal that stops matching reports the reason on its own, which is what
 * every other failure already gets.
 */
export function summaryFailure(
  outcome: AthenaOutcome,
  what: string,
  workgroup: string,
): Error {
  const said = outcome.stateChangeReason ?? "Athena gave no reason.";
  const scanned = `Query ${outcome.queryExecutionId} scanned ${String(outcome.bytesScanned)} bytes.`;

  if (!/bytes scanned limit/iu.test(said)) {
    return new Error(`Computing ${what} failed. ${said} ${scanned}`);
  }

  return new Error(
    `Computing ${what} failed. ${said} ${scanned}\n` +
      `That ceiling is the ${workgroup} workgroup's, and it is there so one` +
      ` query cannot run up a bill nobody chose. A scheduled question reads` +
      ` one window and should be nowhere near it, so check that the query` +
      ` still names its partitions before raising bytesScannedCutoff.`,
  );
}
