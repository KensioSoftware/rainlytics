// Calendar-date arithmetic and conversion to a time-zone boundary.

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const millisecondsPerDay = 86_400_000;

/** The calendar date an instant has under a formatter's time zone. */
export function calendarDateAt(
  at: Date,
  formatter: Intl.DateTimeFormat,
): CalendarDate {
  const values = Object.fromEntries(
    formatter
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: Number(values["year"]),
    month: Number(values["month"]),
    day: Number(values["day"]),
  };
}

/** A calendar date moved by a number of days. */
export function addCalendarDays(
  date: CalendarDate,
  days: number,
): CalendarDate {
  return calendarDateFromMilliseconds(
    calendarDateMilliseconds(date) + days * millisecondsPerDay,
  );
}

/** A date whose month and day may run over their ordinary bounds. */
export function normalisedCalendarDate(
  year: number,
  month: number,
  day: number,
): CalendarDate {
  const at = new Date(0);
  at.setUTCHours(0, 0, 0, 0);
  at.setUTCFullYear(year, month - 1, day);
  return calendarDateFromMilliseconds(at.getTime());
}

/** A calendar date as a UTC number, used only for calendar arithmetic. */
export function calendarDateMilliseconds(date: CalendarDate): number {
  const at = new Date(0);
  at.setUTCHours(0, 0, 0, 0);
  at.setUTCFullYear(date.year, date.month - 1, date.day);
  return at.getTime();
}

/** The UTC calendar fields in a millisecond value. */
function calendarDateFromMilliseconds(milliseconds: number): CalendarDate {
  const at = new Date(milliseconds);
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
  };
}

/** A date in the document's calendar-only representation. */
export function calendarDateText(date: CalendarDate): string {
  return [
    String(date.year).padStart(4, "0"),
    String(date.month).padStart(2, "0"),
    String(date.day).padStart(2, "0"),
  ].join("-");
}
