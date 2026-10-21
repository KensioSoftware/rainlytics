// The span a command line names, read off whichever options named it.
//
// `--last` measures back from now, so both its ends land wherever the clock
// happens to be. A stored window sits on a UTC hour or a UTC day, so no
// `--last` reads exactly one stored day. `--day`, `--from` and `--until` name
// the ends instead. A question answering from a single stored window, the
// conversion rates among them, can then be read for a day it stored.
//
// `backfill` takes `--from` and `--until` too, and reads them the same way
// through `instant-text.ts`. A range written for one command means the same
// span to the other.

import type { TimeRange } from "../time-range.js";
import { lastRange } from "../time-range.js";
import type { OptionValues } from "./command-line.js";
import { UsageError } from "./failure.js";
import { instantFrom, isADay } from "./instant-text.js";
import { chosen } from "./option-values.js";
import { defaultLast } from "./rollup-help.js";

const dayMilliseconds = 86_400_000;

/**
 * The span a named question was asked about.
 *
 * One of three forms, and never two at once. `--last` alone, `--day` alone,
 * or `--from` with `--until` optional after it. A line mixing them would have
 * to pick one and drop the other without saying so. Nothing named means the
 * default `--last`.
 *
 * @throws {UsageError} for a span nobody could act on.
 */
export function askedSpan(
  options: OptionValues,
  command: string,
  now: Date,
): TimeRange {
  const named = (["last", "day", "from", "until"] as const).filter(
    (option) => chosen(options[option]) !== undefined,
  );
  const [first] = named;

  if (first === "day" || first === "last") {
    refuseCompanions(first, named, command);
  }

  const day = chosen(options["day"]);

  if (day !== undefined) {
    return dayRange(day, command);
  }

  const from = chosen(options["from"]);

  if (from !== undefined) {
    return boundedRange(from, chosen(options["until"]), command, now);
  }

  if (named.includes("until")) {
    throw new UsageError(
      `--until needs --from, the start of the span.`,
      command,
    );
  }

  return lastSpan(chosen(options["last"]) ?? defaultLast, command, now);
}

/** Refuses the other span options beside one that stands alone. */
function refuseCompanions(
  alone: "day" | "last",
  named: readonly string[],
  command: string,
): void {
  const other = named.find((option) => option !== alone);

  if (other !== undefined) {
    throw new UsageError(
      `--${alone} names the whole span, so it cannot be given with` +
        ` --${other}. Use one of --last, --day, or --from with --until.`,
      command,
    );
  }
}

/** The UTC day `--day` names, from its midnight to the next. */
function dayRange(text: string, command: string): TimeRange {
  if (!isADay(text)) {
    throw new UsageError(
      `--day takes a UTC day as YYYY-MM-DD, such as 2026-10-11. Got` +
        ` ${JSON.stringify(text)}.`,
      command,
    );
  }

  const from = new Date(`${text}T00:00:00Z`);

  return { from, to: new Date(from.getTime() + dayMilliseconds) };
}

/** The span between `--from` and `--until`, or now where there is no end. */
function boundedRange(
  fromText: string,
  untilText: string | undefined,
  command: string,
  now: Date,
): TimeRange {
  const from = instantFrom(fromText, "from", command);
  const to =
    untilText === undefined ? now : instantFrom(untilText, "until", command);

  if (from >= to) {
    throw new UsageError(
      `--from has to be earlier than --until. Got ${from.toISOString()} and` +
        ` ${to.toISOString()}.`,
      command,
    );
  }

  return { from, to };
}

/** The span `--last` names, with its refusal reported as a usage mistake. */
function lastSpan(text: string, command: string, now: Date): TimeRange {
  try {
    return lastRange(text, now);
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
      command,
    );
  }
}
