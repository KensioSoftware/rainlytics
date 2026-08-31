// Stored UTC summary windows that exactly cover a calendar report period.

import type { ReportPeriod } from "./report-periods.js";
import type { SummaryGranularity, SummaryWindow } from "./summary-windows.js";

const hour = 3_600_000;
const day = 86_400_000;

/** The cheapest stored windows that exactly cover a report period. */
export function reportSourceWindows(
  period: ReportPeriod,
  available: readonly SummaryGranularity[],
): readonly SummaryWindow[] | undefined {
  const from = Date.parse(period.from);
  const until = Date.parse(period.until);

  if (from % hour !== 0 || until % hour !== 0) {
    return undefined;
  }

  const windows: SummaryWindow[] = [];
  let cursor = from;

  while (cursor < until) {
    if (
      available.includes("daily") &&
      cursor % day === 0 &&
      cursor + day <= until
    ) {
      windows.push({ granularity: "daily", at: new Date(cursor) });
      cursor += day;
      continue;
    }

    if (!available.includes("hourly") || cursor + hour > until) {
      return undefined;
    }

    windows.push({ granularity: "hourly", at: new Date(cursor) });
    cursor += hour;
  }

  return windows;
}
