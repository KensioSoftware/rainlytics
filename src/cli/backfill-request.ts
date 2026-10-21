// Turning a backfill command line into one schedule and one range.

import { savedQueryPrefix } from "../dataset.js";
import type { BackfillRange } from "../summary-backfill.js";
import type { SummaryGranularity } from "../summary-windows.js";
import { summaryGranularities } from "../summary-windows.js";
import type { CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
import { instantFrom } from "./instant-text.js";
import { chosen } from "./option-values.js";

/** One backfill read from the command line. */
export interface BackfillRequest {
  /** The question, as its schedule is named. */
  readonly question: string;

  /** Which of its two schedules. */
  readonly granularity: SummaryGranularity;

  /** The range to compute. */
  readonly range: BackfillRange;

  /** The schedule's name, which is where the payload is read from. */
  readonly schedule: string;

  /** The region to ask, where one was named. */
  readonly region: string | undefined;
}

/** Reads and validates the backfill command's arguments and options. */
export function backfillRequestFrom(
  context: CommandContext,
  now: Date,
): BackfillRequest {
  const [question, granularityText, ...extra] = context.args;

  if (
    question === undefined ||
    granularityText === undefined ||
    extra.length > 0
  ) {
    throw new UsageError(
      `backfill takes a question and a granularity. For example,` +
        ` "rainlytics backfill pageviews hourly --from 2026-09-11".`,
      "backfill",
    );
  }

  const granularity = summaryGranularities.find(
    (each) => each === granularityText,
  );

  if (granularity === undefined) {
    throw new UsageError(
      `The granularity must be hourly or daily. Got ${JSON.stringify(granularityText)}.`,
      "backfill",
    );
  }

  const fromText = chosen(context.options["from"]);

  if (fromText === undefined) {
    throw new UsageError(
      `backfill needs --from, the start of the range to compute.`,
      "backfill",
    );
  }

  const from = instantFrom(fromText, "from", "backfill");
  const untilText = chosen(context.options["until"]);
  const until =
    untilText === undefined ? now : instantFrom(untilText, "until", "backfill");

  if (from >= until) {
    throw new UsageError(
      `--from has to be earlier than --until. Got ${from.toISOString()} and` +
        ` ${until.toISOString()}.`,
      "backfill",
    );
  }

  const prefix = chosen(context.options["schedule-prefix"]) ?? savedQueryPrefix;

  return {
    question,
    granularity,
    range: { from, until },
    schedule: `${prefix}${question}-${granularity}`,
    region: chosen(context.options["region"]),
  };
}
