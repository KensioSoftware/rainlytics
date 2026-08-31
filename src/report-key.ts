// The S3 address shared by a report writer and reader.

import { reportSchemaVersion } from "./report-document.js";
import type { ReportPeriod } from "./report-periods.js";

/**
 * The deterministic S3 key for a report.
 *
 * The time zone is escaped into one path segment. A week also carries its
 * first weekday because changing it changes every weekly period.
 */
export function reportKey(period: ReportPeriod): string {
  const segments = [
    "reports",
    `v${String(reportSchemaVersion)}`,
    encodeURIComponent(period.timeZone),
    period.unit,
  ];

  if (period.unit === "week") {
    segments.push(period.weekStartsOn);
  }

  segments.push(`${period.startsOn}.json`);
  return segments.join("/");
}
