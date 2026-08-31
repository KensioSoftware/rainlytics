// Turning a calendar date selector into one closed report period.

import { calendarBoundary } from "../report-calendar-boundary.js";
import { calendarDateAt, type CalendarDate } from "../report-calendar-date.js";
import {
  type ReportPeriod,
  type ReportPeriodUnit,
  reportPeriod,
  type ReportWeekday,
} from "../report-periods.js";
import { UsageError } from "./failure.js";
import {
  calendarDateFromSelector,
  reportCalendarDateText,
} from "./report-calendar-selector.js";

/** Builds the closed period containing the selected local calendar date. */
export function selectedReportPeriod(
  unit: ReportPeriodUnit,
  selector: string,
  timeZone: string,
  weekStartsOn: ReportWeekday,
): ReportPeriod {
  const date = calendarDateFromSelector(unit, selector);
  const formatter = calendarFormatter(timeZone);
  const at = calendarBoundary(date, formatter);
  const actual = calendarDateAt(at, formatter);

  if (!sameDate(actual, date)) {
    throw new UsageError(
      `The calendar date ${reportCalendarDateText(date)} does not exist in` +
        ` ${formatter.resolvedOptions().timeZone}.`,
      "report",
    );
  }

  try {
    const request = {
      at,
      timeZone: formatter.resolvedOptions().timeZone,
      weekStartsOn,
    };
    const now = new Date();

    if (unit === "week") {
      return reportPeriod({ ...request, unit }, now);
    }

    return reportPeriod({ ...request, unit }, now);
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
      "report",
    );
  }
}

/** A Gregorian formatter for one IANA time zone. */
function calendarFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new UsageError(
      `The report time zone ${JSON.stringify(timeZone)} is not valid.`,
      "report",
    );
  }
}

/** Whether two calendar date records carry the same date. */
function sameDate(left: CalendarDate, right: CalendarDate): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day
  );
}
