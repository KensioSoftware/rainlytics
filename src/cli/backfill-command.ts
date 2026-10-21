// `rainlytics backfill`, which fills in summary windows the schedule missed.
//
// The one command that writes. Every other command reads a summary or runs a
// query of somebody's own, and this invokes the deployment's summary function
// to put objects in its bucket. It invokes rather than computing here, so the
// summaries come from the function's own code, SQL and role, and are the
// objects a scheduled run would have written.

import type { BackfillProgress } from "../summary-backfill.js";
import { backfillWindows } from "../summary-backfill.js";
import type { Command, CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
import type { CommandResult } from "./output/result.js";
import { backfillDescription, backfillOptions } from "./backfill-help.js";
import { openBackfillInvoker, scheduledTarget } from "./backfill-invocation.js";
import { backfillRequestFrom } from "./backfill-request.js";
import { backfillPlanned, backfillProgressed } from "./backfill-report.js";

/** Invokes the summary function until the range is computed. */
async function run(context: CommandContext): Promise<CommandResult> {
  const asked = backfillRequestFrom(context, new Date());
  const windows = backfillWindows(asked.range, asked.granularity, new Date());

  if (windows.length === 0) {
    throw new UsageError(
      `No ${asked.granularity} window between ${asked.range.from.toISOString()}` +
        ` and ${asked.range.until.toISOString()} has closed yet.`,
      "backfill",
    );
  }

  const target = await scheduledTarget(asked);
  const invoker = await openBackfillInvoker(target, asked.region);
  const rows: CommandResult["rows"][number][] = [];

  context.io.error(backfillPlanned(asked, windows.length, target.payload));

  try {
    let payload: Readonly<Record<string, unknown>> | undefined = {
      ...target.payload,
      backfill: {
        from: asked.range.from.toISOString(),
        until: asked.range.until.toISOString(),
      },
    };

    while (payload !== undefined) {
      // One invocation at a time, since each one carries on from the last.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const progress: BackfillProgress = await invoker.invoke(payload);

      rows.push({
        invocation: rows.length + 1,
        windows: progress.computed.length,
        first: progress.computed[0],
        last: progress.computed.at(-1),
      });
      context.io.error(backfillProgressed(progress));
      payload = progress.next;
    }
  } finally {
    invoker.close();
  }

  return { columns: ["invocation", "windows", "first", "last"], rows };
}

/** `rainlytics backfill`, for summary windows the schedule never wrote. */
export const backfillCommand: Command = {
  name: "backfill",
  summary: "Compute summary windows the schedule missed.",
  usage:
    "rainlytics backfill <question> <hourly|daily> --from <instant> [options]",
  description: backfillDescription,
  options: backfillOptions,
  run,
};
