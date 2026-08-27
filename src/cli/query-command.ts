// `rainlytics query`, which is the whole of reading the data back by hand.

import { defaultLogDataset, defaultWorkgroupName } from "../dataset.js";
import type { Command, CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
import type { CommandResult } from "./output/result.js";
import {
  databaseOption,
  queryDescription,
  regionOption,
  workgroupOption,
} from "./query-help.js";
import { queryRows } from "./query-run.js";

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
function chosen(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Runs the query and answers with its rows. */
async function run(context: CommandContext): Promise<CommandResult> {
  return queryRows(
    {
      sql: sqlFrom(context.args),
      database:
        chosen(context.options["database"]) ?? defaultLogDataset.databaseName,
      workgroup: chosen(context.options["workgroup"]) ?? defaultWorkgroupName,
      region: chosen(context.options["region"]),
    },
    context.io,
  );
}

/** `rainlytics query`, for asking the log table a question of your own. */
export const queryCommand: Command = {
  name: "query",
  summary: "Run SQL against the log table.",
  usage: 'rainlytics query "<sql>" [options]',
  description: queryDescription,
  options: [databaseOption, workgroupOption, regionOption],
  run,
};
