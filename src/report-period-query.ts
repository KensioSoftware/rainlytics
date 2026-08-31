// Filling a scheduled rollup query with one calendar report period.

import type { ReportPeriod } from "./report-periods.js";
import { partitionPredicate, windowPlaceholder } from "./rollup-rows.js";
import type { SummarySpan } from "./summary-windows.js";

/** Fills a scheduled query's window placeholder with a report period. */
export function periodQuerySql(template: string, period: ReportPeriod): string {
  if (!template.includes(windowPlaceholder)) {
    throw new Error(
      `A report query has to say which period it reads, and this one carries` +
        ` no ${windowPlaceholder}. Build it with rollupSql under the` +
        ` summarisedWindow range.`,
    );
  }

  const until = Date.parse(period.until);

  return template.replaceAll(
    windowPlaceholder,
    partitionPredicate({
      from: new Date(period.from),
      to: new Date(until - 1),
    }),
  );
}

/** One source span naming a period-wide query. */
export function periodQuerySpan(period: ReportPeriod): SummarySpan {
  return {
    // ReportSectionSource drops the granularity. The span itself is exact.
    granularity: "daily",
    from: period.from,
    until: period.until,
  };
}
