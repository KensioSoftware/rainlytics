// Validating one question embedded in a calendar report schedule.

import type { ReportCompositionRule } from "../report-section-types.js";
import {
  reportInputRecord,
  reportInputRefusal,
} from "./report-input-validation.js";
import type { ReportQuestionRun, ReportTotals } from "./report-run.js";
import { runFrom as summaryRunFrom } from "./summary-run.js";

/** One embedded question, checked through the summary run parser as well. */
export function reportQuestionFrom(value: unknown): ReportQuestionRun {
  const found = reportInputRecord(value);
  const rule = found["rule"];
  const calculation = found["calculation"];
  const totals = found["totals"];
  const summary = summaryRunFrom({
    question: found["question"],
    granularity: "daily",
    sql: found["sql"],
    ...(found["visitorSql"] === undefined
      ? {}
      : { visitorSql: found["visitorSql"] }),
  });

  if (!isRule(rule) || !isCalculation(calculation)) {
    throw reportInputRefusal(value);
  }

  const parsedTotals = totals === undefined ? undefined : totalsFrom(totals);

  if (calculation === "summaries" && parsedTotals === undefined) {
    throw reportInputRefusal(value);
  }

  return {
    question: summary.question,
    sql: summary.sql,
    ...(summary.visitorSql === undefined
      ? {}
      : { visitorSql: summary.visitorSql }),
    rule,
    calculation,
    ...(parsedTotals === undefined ? {} : { totals: parsedTotals }),
  };
}

function totalsFrom(value: unknown): ReportTotals {
  const found = reportInputRecord(value);
  const added = found["added"];

  if (
    !Array.isArray(added) ||
    !added.every((column) => typeof column === "string")
  ) {
    throw reportInputRefusal(value);
  }

  return { added };
}

function isRule(value: unknown): value is ReportCompositionRule {
  return ["additive", "ranked", "visitor-count", "percentile"].includes(
    value as ReportCompositionRule,
  );
}

function isCalculation(
  value: unknown,
): value is ReportQuestionRun["calculation"] {
  return value === "summaries" || value === "period-query";
}
