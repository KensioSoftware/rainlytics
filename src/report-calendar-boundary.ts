// The first UTC instant on a local calendar date.

import {
  calendarDateAt,
  calendarDateMilliseconds,
  type CalendarDate,
} from "./report-calendar-date.js";

const millisecondsPerDay = 86_400_000;

/**
 * The first instant whose local calendar date reaches a target date.
 *
 * The search uses calendar dates, not offsets. It therefore covers midnight
 * offset changes and the 23-hour and 25-hour days around daylight saving.
 */
export function calendarBoundary(
  date: CalendarDate,
  formatter: Intl.DateTimeFormat,
): Date {
  const target = calendarDateMilliseconds(date);
  let lower = target - 2 * millisecondsPerDay;
  let upper = target + 2 * millisecondsPerDay;

  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const local = calendarDateMilliseconds(
      calendarDateAt(new Date(middle), formatter),
    );

    if (local < target) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }

  return new Date(lower);
}
