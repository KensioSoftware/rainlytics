// Running one query for a command, and saying what it cost.
//
// Every command that reaches Athena does the same three things around the
// query itself. It writes where the query ran and what it scanned to standard
// error, it explains a failure, and it turns an outcome into the table a
// command answers with. Three copies of that would drift, and the way they
// drift is one command reporting a price and another quietly not.

import { runAthenaQuery } from "../athena/athena-query.js";
import type { AthenaOutcome, AthenaQuery } from "../athena/athena-outcome.js";
import { cannotRunQueries, isDenied } from "./access-refusals.js";
import type { UsageError } from "./failure.js";
import type { CliIo } from "./io.js";
import type { CommandResult } from "./output/result.js";
import { scanReport, whereItRan } from "./query-report.js";

/**
 * Explains a query Athena would not finish.
 *
 * The cutoff is the failure worth saying more about. It is the one this
 * pipeline sets deliberately, and the one whose reason reads as a wall rather
 * than as a limit somebody chose and can move.
 *
 * Matched on the reason text, which is the only signal Athena gives. A cutoff
 * refusal that stops matching reports the reason on its own, which is the
 * behaviour every other failure already gets.
 */
export function queryFailure(
  reason: string | undefined,
  workgroup: string,
): UsageError | Error {
  const said = reason ?? "Athena gave no reason.";

  if (!/bytes scanned limit/iu.test(said)) {
    return new Error(said);
  }

  return new Error(
    `${said}\n` +
      `That ceiling is the workgroup's, and it is there so one query cannot` +
      ` run up a bill nobody chose. Narrow the query by naming` +
      ` distributionid, year, month, day or hour, or raise` +
      ` bytesScannedCutoff on the ${workgroup} workgroup if the query really` +
      ` needs to read that much.`,
  );
}

/**
 * Runs the query, explaining a permission the caller is missing.
 *
 * The command line is where this belongs. `refusalIn` is shared with the
 * scheduled job, and the job has no summary to offer somebody it cannot query
 * for.
 *
 * Anything else comes back as it was thrown. Athena refuses a query for
 * plenty of reasons this has nothing to say about.
 *
 * @throws {Error} for a query that could not run.
 */
async function ranQuery(query: AthenaQuery): Promise<AthenaOutcome> {
  try {
    return await runAthenaQuery(query);
  } catch (error) {
    if (isDenied(error)) {
      throw cannotRunQueries(error, query.workgroup);
    }

    throw error;
  }
}

/**
 * Runs one query, reports it, and answers with its rows.
 *
 * The report goes to standard error whether the query succeeded or not. A
 * query that scanned a lot before giving up is worth knowing about, and the
 * execution id is what finds it again in the console.
 *
 * @throws {Error} carrying Athena's own reason, for a query that did not
 *   succeed.
 */
export async function queryRows(
  query: AthenaQuery,
  io: CliIo,
): Promise<CommandResult> {
  const outcome = await ranQuery(query);

  io.error(whereItRan(outcome, query.workgroup));
  io.error(
    scanReport(
      outcome.bytesScanned,
      outcome.milliseconds,
      outcome.state !== "FAILED",
    ),
  );

  if (outcome.state !== "SUCCEEDED") {
    throw queryFailure(outcome.stateChangeReason, query.workgroup);
  }

  return {
    columns: outcome.columns.map((column) => column.name),
    rows: outcome.rows,
  };
}
