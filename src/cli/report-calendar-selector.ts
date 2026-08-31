// Reading the date spelling accepted by `rainlytics report`.

import type { CalendarDate } from "../report-calendar-date.js";
import type { ReportPeriodUnit } from "../report-periods.js";
import { UsageError } from "./failure.js";

/** Reads a unit-specific date shorthand as a calendar date. */
export function calendarDateFromSelector(
  unit: ReportPeriodUnit,
  selector: string,
): CalendarDate {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(
    expandedSelector(unit, selector),
  );

  if (matched === null) {
    throw new UsageError(
      `The ${unit} report date ${JSON.stringify(selector)} is not` +
        ` ${selectorFormat(unit)}.`,
      "report",
    );
  }

  const date = {
    year: Number(matched[1]),
    month: Number(matched[2]),
    day: Number(matched[3]),
  };
  const checked = new Date(Date.UTC(date.year, date.month - 1, date.day));

  if (
    checked.getUTCFullYear() !== date.year ||
    checked.getUTCMonth() + 1 !== date.month ||
    checked.getUTCDate() !== date.day
  ) {
    throw new UsageError(
      `${JSON.stringify(selector)} is not a calendar date.`,
      "report",
    );
  }

  return date;
}

/** Expands the shorthand accepted for a larger period. */
function expandedSelector(unit: ReportPeriodUnit, selector: string): string {
  if (unit === "year" && /^\d{4}$/u.test(selector)) {
    return `${selector}-01-01`;
  }

  if (unit === "month" && /^\d{4}-\d{2}$/u.test(selector)) {
    return `${selector}-01`;
  }

  return selector;
}

/** The date spelling a unit accepts. */
function selectorFormat(unit: ReportPeriodUnit): string {
  if (unit === "year") {
    return "YYYY or YYYY-MM-DD";
  }

  if (unit === "month") {
    return "YYYY-MM or YYYY-MM-DD";
  }

  return "YYYY-MM-DD";
}

/** A calendar date in the selector's full spelling. */
export function reportCalendarDateText(date: CalendarDate): string {
  return [date.year, date.month, date.day]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}
