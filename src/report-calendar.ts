// IANA calendar arithmetic used to place report period boundaries in UTC.

import type { ReportPeriodUnit, ReportWeekday } from "./report-period-types.js";
import { calendarBoundary } from "./report-calendar-boundary.js";
import {
  addCalendarDays,
  calendarDateAt,
  calendarDateMilliseconds,
  calendarDateText,
  type CalendarDate,
  normalisedCalendarDate,
} from "./report-calendar-date.js";

/** The local dates and UTC instants around one addressed calendar period. */
export interface ReportCalendarBounds {
  readonly timeZone: string;
  readonly startsOn: string;
  readonly endsBefore: string;
  readonly from: Date;
  readonly until: Date;
}

const weekdays: readonly ReportWeekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** The calendar bounds containing one instant. */
export function reportCalendarBounds(
  unit: ReportPeriodUnit,
  at: Date,
  timeZone: string,
  weekStartsOn: ReportWeekday,
): ReportCalendarBounds {
  const formatter = calendarFormatter(timeZone);
  const local = calendarDateAt(at, formatter);
  const starts = periodStart(unit, local, weekStartsOn);
  const ends = periodEnd(unit, starts);

  return {
    timeZone: formatter.resolvedOptions().timeZone,
    startsOn: calendarDateText(starts),
    endsBefore: calendarDateText(ends),
    from: calendarBoundary(starts, formatter),
    until: calendarBoundary(ends, formatter),
  };
}

/** A formatter whose parts are Gregorian calendar numbers in one zone. */
function calendarFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new RangeError(`The report time zone "${timeZone}" is not valid.`);
  }
}

/** The first date of the calendar unit holding a date. */
function periodStart(
  unit: ReportPeriodUnit,
  date: CalendarDate,
  weekStartsOn: ReportWeekday,
): CalendarDate {
  switch (unit) {
    case "day": {
      return date;
    }
    case "week": {
      const weekday = new Date(calendarDateMilliseconds(date)).getUTCDay();
      const first = weekdays.indexOf(weekStartsOn);
      return addCalendarDays(date, -((weekday - first + weekdays.length) % 7));
    }
    case "month": {
      return { year: date.year, month: date.month, day: 1 };
    }
    case "year": {
      return { year: date.year, month: 1, day: 1 };
    }
  }
}

/** The first date after a period. */
function periodEnd(unit: ReportPeriodUnit, starts: CalendarDate): CalendarDate {
  switch (unit) {
    case "day": {
      return addCalendarDays(starts, 1);
    }
    case "week": {
      return addCalendarDays(starts, 7);
    }
    case "month": {
      return normalisedCalendarDate(starts.year, starts.month + 1, 1);
    }
    case "year": {
      return normalisedCalendarDate(starts.year + 1, 1, 1);
    }
  }
}
