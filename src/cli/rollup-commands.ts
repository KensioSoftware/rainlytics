// The four questions as subcommands.
//
// One shape, four instances. Each takes the same range, the same bot filter
// and the same output format, and differs only in the rollup it runs. Writing
// them out four times would let them drift into four slightly different
// commands.
//
// Nothing here computes an answer. The rollup writes SQL, Athena answers it,
// and this is the argument handling in between. When M3 lands, each of these
// reads a precomputed summary off S3 instead and the command surface does not
// move.

import type { Rollup } from "../rollups.js";
import { rollupSql } from "../rollups.js";
import type { Command, CommandContext } from "./command.js";
import type { CommandResult } from "./output/result.js";
import { rollupOptions } from "./rollup-command-options.js";
import { requestFrom } from "./rollup-options.js";
import { queryRows } from "./query-run.js";

/** Runs one rollup and answers with its rows. */
async function runRollup(
  rollup: Rollup,
  context: CommandContext,
): Promise<CommandResult> {
  const asked = requestFrom(context, rollup);

  return queryRows(
    {
      sql: rollupSql(rollup, asked.request),
      database: asked.database,
      workgroup: asked.workgroup,
      region: asked.region,
    },
    context.io,
  );
}

/** One rollup as a subcommand. */
export function rollupCommand(rollup: Rollup): Command {
  return {
    name: rollup.name,
    summary: rollup.summary,
    description: rollup.description,
    options: rollupOptions(rollup),
    run: async (context) => runRollup(rollup, context),
  };
}
