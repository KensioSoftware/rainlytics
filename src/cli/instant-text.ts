// The two ways a command line writes one end of a span.
//
// Apart from `asked-span.ts`, which decides which options named the span.
// `backfill` reads its own `--from` and `--until` through here as well.

import { UsageError } from "./failure.js";

/** A day, being midnight UTC. */
const aDay = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * An instant with its offset written out.
 *
 * Without one, `Date` reads the text in whatever zone the machine is in, and
 * the same command line would name a different span on a laptop in London
 * from the one it names in CI.
 */
const anInstant =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * One end of a range, or a refusal naming the option.
 *
 * YYYY-MM-DD is midnight UTC at the start of that day. Anything finer carries
 * its offset.
 *
 * @throws {UsageError} for text that is neither, or for a day the calendar
 *   does not have.
 */
export function instantFrom(
  text: string,
  option: string,
  command: string,
): Date {
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
      command,
    );
  }

  return instant;
}

/** Whether text is a day written YYYY-MM-DD that the calendar has. */
export function isADay(text: string): boolean {
  return aDay.test(text) && isCalendarDay(text);
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
