// Describing mismatched fields in two stored report periods.

import type { ReportPeriod } from "./report-periods.js";

/** Describes each calendar field whose expected and stored values differ. */
export function reportPeriodDifference(
  expected: ReportPeriod,
  actual: ReportPeriod,
): string {
  const expectedFields = reportPeriodFields(expected);
  const actualFields = reportPeriodFields(actual);

  return Object.entries(expectedFields)
    .filter(([field, value]) => actualFields[field] !== value)
    .map(
      ([field, value]) =>
        `${field} expected ${JSON.stringify(value)} but got` +
        ` ${JSON.stringify(actualFields[field])}`,
    )
    .join(", ");
}

/** Calendar fields used to identify an adjacent stored report. */
function reportPeriodFields(
  period: ReportPeriod,
): Readonly<Record<string, string>> {
  return {
    unit: period.unit,
    timeZone: period.timeZone,
    weekStartsOn:
      period.unit === "week" ? period.weekStartsOn : "not-applicable",
    startsOn: period.startsOn,
    endsBefore: period.endsBefore,
    from: period.from,
    until: period.until,
  };
}
