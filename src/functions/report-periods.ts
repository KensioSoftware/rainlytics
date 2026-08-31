// Closed calendar periods one daily report run needs to write.

import { reportCalendarBounds } from "../report-calendar.js";
import type {
  ReportPeriod,
  ReportPeriodUnit,
  ReportWeekday,
} from "../report-periods.js";
import { reportPeriod, reportPeriodUnits } from "../report-periods.js";

/** The periods closing on the latest closed local dates, shortest first. */
export function closingReportPeriods(
  now: Date,
  timeZone: string,
  weekStartsOn: ReportWeekday,
  days: number,
): readonly ReportPeriod[] {
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new RangeError(
      `A report run covers a whole number of closing days, at least one.` +
        ` Got ${String(days)}.`,
    );
  }

  const today = reportCalendarBounds("day", now, timeZone, weekStartsOn);
  let insideClosedDay = new Date(today.from.getTime() - 1);
  const periods: ReportPeriod[] = [];

  for (let taken = 0; taken < days; taken += 1) {
    const day = reportPeriod(
      { unit: "day", at: insideClosedDay, timeZone },
      now,
    );

    for (const unit of reportPeriodUnits) {
      const bounds = reportCalendarBounds(
        unit,
        insideClosedDay,
        timeZone,
        weekStartsOn,
      );

      if (bounds.until.toISOString() !== day.until) {
        continue;
      }

      const period = periodContaining(
        unit,
        insideClosedDay,
        now,
        timeZone,
        weekStartsOn,
      );

      periods.push(period);
    }

    insideClosedDay = new Date(Date.parse(day.from) - 1);
  }

  return periods;
}

/** One unit containing an instant known to sit in a closed local day. */
function periodContaining(
  unit: ReportPeriodUnit,
  at: Date,
  now: Date,
  timeZone: string,
  weekStartsOn: ReportWeekday,
): ReportPeriod {
  return unit === "week"
    ? reportPeriod({ unit, at, timeZone, weekStartsOn }, now)
    : reportPeriod({ unit, at, timeZone }, now);
}
