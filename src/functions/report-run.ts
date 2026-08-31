// What one daily firing asks the calendar report job to calculate.

import type { ReportCompositionRule } from "../report-section-types.js";
import type { ReportWeekday } from "../report-periods.js";
import type { RollupTotals } from "../rollups.js";
import type { SummaryGranularity } from "../summary-windows.js";
import type { SummaryRun } from "./summary-run.js";

export { reportRunFrom } from "./report-run-input.js";

/** The serialisable part of a rollup's addition rules. */
export interface ReportTotals {
  readonly added: readonly string[];
}

/** One question a report contains and how the writer calculates it. */
export interface ReportQuestionRun extends Omit<SummaryRun, "granularity"> {
  readonly rule: ReportCompositionRule;
  readonly calculation: "summaries" | "period-query";
  readonly totals?: ReportTotals | undefined;
}

/** One daily report schedule's target input. */
export interface ReportRun {
  readonly timeZone: string;
  readonly weekStartsOn: ReportWeekday;
  readonly recomputedDays: number;
  readonly granularities: readonly SummaryGranularity[];
  readonly questions: readonly ReportQuestionRun[];
}

/** Builds one serialisable question from a summary run and its rollup. */
export function reportQuestionRun(
  run: SummaryRun,
  rule: ReportCompositionRule,
  calculation: ReportQuestionRun["calculation"],
  totals?: RollupTotals,
): ReportQuestionRun {
  return {
    question: run.question,
    sql: run.sql,
    ...(run.visitorSql === undefined ? {} : { visitorSql: run.visitorSql }),
    rule,
    calculation,
    ...(totals === undefined ? {} : { totals: { added: totals.added } }),
  };
}
