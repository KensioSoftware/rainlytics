// Closed calendar periods for reports.
//
// Summary windows are UTC hours and days. Reports use the calendar somebody
// reads under, which can put midnight at another UTC instant and can make a
// day 23 or 25 hours long. The conversion lives in `report-calendar.ts`.

import { reportCalendarBounds } from "./report-calendar.js";
import {
  defaultReportWeekStartsOn,
  type ReportPeriod,
  type ReportPeriodRequest,
  type ReportPeriodWithoutWeek,
  type ReportWeekPeriod,
} from "./report-period-types.js";

export {
  defaultReportWeekStartsOn,
  type ReportPeriod,
  type ReportPeriodRequest,
  type ReportPeriodUnit,
  type ReportPeriodWithoutWeek,
  reportPeriodUnits,
  type ReportWeekday,
  type ReportWeekPeriod,
} from "./report-period-types.js";

/**
 * Builds the closed calendar period containing an instant.
 *
 * `asOf` is the instant at which the report would be built. The period has
 * to end at or before it. Passing the clock in makes a scheduled writer's
 * decision reproducible, while the default suits an interactive caller.
 *
 * @throws {RangeError} for an invalid date, time zone or unfinished period.
 */
export function reportPeriod(
  request: ReportPeriodRequest & { readonly unit: "week" },
  asOf?: Date,
): ReportWeekPeriod;
export function reportPeriod(
  request: ReportPeriodRequest & {
    readonly unit: "day" | "month" | "year";
  },
  asOf?: Date,
): ReportPeriodWithoutWeek;
export function reportPeriod(
  request: ReportPeriodRequest,
  asOf: Date = new Date(),
): ReportPeriod {
  assertDate(request.at, "report period");
  assertDate(asOf, "report computation time");

  const weekStartsOn = request.weekStartsOn ?? defaultReportWeekStartsOn;
  const bounds = reportCalendarBounds(
    request.unit,
    request.at,
    request.timeZone,
    weekStartsOn,
  );

  if (bounds.until.getTime() > asOf.getTime()) {
    throw new RangeError(
      `The ${request.unit} starting ${bounds.startsOn} in` +
        ` ${bounds.timeZone} has not closed. It closes at` +
        ` ${bounds.until.toISOString()}.`,
    );
  }

  const period = {
    unit: request.unit,
    timeZone: bounds.timeZone,
    startsOn: bounds.startsOn,
    endsBefore: bounds.endsBefore,
    from: bounds.from.toISOString(),
    until: bounds.until.toISOString(),
  };

  return request.unit === "week"
    ? { ...period, unit: "week", weekStartsOn }
    : { ...period, unit: request.unit };
}

/** Refuses a Date whose instant does not exist. */
function assertDate(date: Date, subject: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Cannot build a ${subject} from an invalid Date.`);
  }
}
