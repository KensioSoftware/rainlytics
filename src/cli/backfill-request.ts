// Turning a backfill command line into one schedule and one range.

import { savedQueryPrefix } from "../dataset.js";
import type { BackfillRange } from "../summary-backfill.js";
import type { SummaryGranularity } from "../summary-windows.js";
import { summaryGranularities } from "../summary-windows.js";
import type { CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
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

/** A day, being midnight UTC. */
const aDay = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * An instant with its offset written out.
 *
 * Without one, `Date` reads the text in whatever zone the machine is in, and
 * the same command line would backfill a different range on a laptop in
 * London from the one it backfills in CI.
 */
const anInstant =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;

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

  const from = instantFrom(fromText, "from");
  const untilText = chosen(context.options["until"]);
  const until = untilText === undefined ? now : instantFrom(untilText, "until");

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

/**
 * Whether a YYYY-MM-DD names a day the calendar has.
 *
 * `Date` rolls 2026-02-30 on into March in either form, offset or not. The
 * date part is checked on its own, since an offset can move the instant onto
 * another day.
 */
function isCalendarDay(day: string): boolean {
  return new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
}

/** One end of the range, or a refusal naming the option. */
function instantFrom(text: string, option: string): Date {
  const instant = aDay.test(text)
    ? new Date(`${text}T00:00:00Z`)
    : anInstant.test(text)
      ? new Date(text)
      : undefined;

  if (
    instant === undefined ||
    Number.isNaN(instant.getTime()) ||
    !isCalendarDay(text.slice(0, 10))
  ) {
    throw new UsageError(
      `--${option} takes YYYY-MM-DD for midnight UTC, or an ISO 8601 instant` +
        ` with its offset such as 2026-09-11T06:00Z. Got ${JSON.stringify(text)}.`,
      "backfill",
    );
  }

  return instant;
}
