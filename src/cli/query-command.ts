// `rainlytics query`, which is the whole of reading the data back by hand.

import { defaultLogDataset, defaultWorkgroupName } from "../dataset.js";
import { runAthenaQuery } from "./athena-query.js";
import type { Command, CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
import type { CommandResult } from "./output/result.js";
import {
  databaseOption,
  queryDescription,
  workgroupOption,
} from "./query-help.js";
import { scanReport } from "./query-report.js";

/**
 * The SQL to run, as one argument.
 *
 * @throws {UsageError} where none was given, or where the shell split it.
 */
function sqlFrom(args: readonly string[]): string {
  const [sql, ...rest] = args;

  if (sql === undefined) {
    throw new UsageError(
      "query takes the SQL to run, as one quoted argument.",
      "query",
    );
  }

  if (rest.length > 0) {
    throw new UsageError(
      `query takes one argument and got ${String(args.length)}. Quote the` +
        ` whole statement, or the shell splits it on spaces and drops the` +
        ` quotes inside it.`,
      "query",
    );
  }

  return sql;
}

/** The text of an option, where one was given. */
function chosen(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

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

/** Runs the query and answers with its rows. */
async function run(context: CommandContext): Promise<CommandResult> {
  const workgroup =
    chosen(context.options["workgroup"]) ?? defaultWorkgroupName;
  const outcome = await runAthenaQuery({
    sql: sqlFrom(context.args),
    database:
      chosen(context.options["database"]) ?? defaultLogDataset.databaseName,
    workgroup,
  });

  context.io.error(
    `Query ${outcome.queryExecutionId} ran in workgroup ${workgroup}.\n`,
  );
  context.io.error(
    scanReport(
      outcome.bytesScanned,
      outcome.milliseconds,
      outcome.state !== "FAILED",
    ),
  );

  if (outcome.state !== "SUCCEEDED") {
    throw queryFailure(outcome.stateChangeReason, workgroup);
  }

  return {
    columns: outcome.columns.map((column) => column.name),
    rows: outcome.rows,
  };
}

/** `rainlytics query`, for asking the log table a question of your own. */
export const queryCommand: Command = {
  name: "query",
  summary: "Run SQL against the log table.",
  usage: 'rainlytics query "<sql>" [options]',
  description: queryDescription,
  options: [databaseOption, workgroupOption],
  run,
};
