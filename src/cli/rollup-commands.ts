// The five questions as subcommands.
//
// One shape, five instances. Each takes the same range, the same bot filter
// and the same output format, and differs only in the rollup it runs. Writing
// them out five times would let them drift into five slightly different
// commands.
//
// Nothing here computes an answer. A schedule counted it, `summary-answer.ts`
// reads what it wrote, and `--query` sends the same question to Athena for a
// fresher one. The command surface is where it was in M2, which is the swap
// `AGENTS.md` and the docs have promised since then.

import type { Rollup } from "../rollups.js";
import { rollupSql } from "../rollups.js";
import type { Command, CommandContext } from "./command.js";
import type { CommandResult } from "./output/result.js";
import { rollupOptions } from "./rollup-command-options.js";
import { requestFrom } from "./rollup-options.js";
import { queryRows } from "./query-run.js";
import { summaryRows } from "./summary-answer.js";
import { readingASummary } from "./summary-help.js";

/** Runs one rollup and answers with its rows. */
async function runRollup(
  rollup: Rollup,
  context: CommandContext,
): Promise<CommandResult> {
  const asked = requestFrom(context, rollup);

  if (!asked.runsTheQuery) {
    return summaryRows(rollup, asked, context.io);
  }

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
    description: `${rollup.description}\n\n${readingASummary}`,
    options: rollupOptions(rollup),
    run: async (context) => runRollup(rollup, context),
  };
}
