// `rainlytics saved-query`, which runs a question this package never shipped.
//
// A site with a rollup of its own saves it in the workgroup through the
// RollupQueries construct, and this runs it by name. Nothing here imports the
// site's code or asks for a build step, and the SQL that runs is the SQL the
// Athena console shows.
//
// The range, the row count and the filters are the ones the saved query was
// written with, so the options a rollup command takes are absent rather than
// silently ignored. `saved-query-help.ts` says so where somebody will read it.

import { defaultWorkgroupName } from "../dataset.js";
import type { Command, CommandContext } from "./command.js";
import type { CommandResult } from "./output/result.js";
import { regionOption, workgroupOption } from "./query-help.js";
import { queryRows } from "./query-run.js";
import { savedQueries } from "./saved-queries.js";
import { savedQueryDescription } from "./saved-query-help.js";
import {
  nameFrom,
  savedQueryCommandName,
  savedQueryNamed,
} from "./saved-query-name.js";

/** The text of an option, where one was given. */
function chosen(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Finds the saved query, runs it, and answers with its rows. */
async function run(context: CommandContext): Promise<CommandResult> {
  const workgroup =
    chosen(context.options["workgroup"]) ?? defaultWorkgroupName;
  const region = chosen(context.options["region"]);
  const name = nameFrom(context.args);
  const found = savedQueryNamed(
    await savedQueries({ workgroup, region }),
    name,
    workgroup,
  );

  return queryRows(
    {
      sql: found.sql,
      database: found.database,
      workgroup,
      region,
    },
    context.io,
  );
}

/** `rainlytics saved-query`, for a question a site saved for itself. */
export const savedQueryCommand: Command = {
  name: savedQueryCommandName,
  summary: "Run a query saved in the workgroup, by name.",
  usage: `rainlytics ${savedQueryCommandName} <name> [options]`,
  description: savedQueryDescription,
  options: [workgroupOption, regionOption],
  run,
};
