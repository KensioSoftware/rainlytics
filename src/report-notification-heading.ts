// Formatting calendar period headings for report notifications.

import type { ReportDocument } from "./report-document.js";

/** A compact period heading using inclusive local dates. */
export function reportNotificationHeading(document: ReportDocument): string {
  const { period } = document;
  const name = period.unit[0]?.toUpperCase() + period.unit.slice(1);

  return period.unit === "day"
    ? `${name} ${period.startsOn}`
    : `${name} ${period.startsOn} to ${dateBefore(period.endsBefore)}`;
}

/** The local date immediately before an exclusive ISO date. */
function dateBefore(date: string): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}
