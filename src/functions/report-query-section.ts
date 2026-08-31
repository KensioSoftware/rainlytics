// A row section queried directly over one calendar report period.

import { runAthenaQuery } from "../athena/athena-query.js";
import type { ReportPeriod } from "../report-periods.js";
import { periodQuerySpan, periodQuerySql } from "../report-period-query.js";
import type { ReportSection } from "../report-section-types.js";
import { reportSection } from "../report-sections.js";
import type { ReportDeployment } from "./report-deployment.js";
import {
  assertReportQuerySucceeded,
  reportRowsValue,
} from "./report-query-result.js";
import type { ReportQuestionRun } from "./report-run.js";

/** Exact rows returned by one query over the report period. */
export async function queriedRowsSection(
  period: ReportPeriod,
  question: ReportQuestionRun,
  deployment: ReportDeployment,
): Promise<ReportSection> {
  const outcome = await runAthenaQuery({
    sql: periodQuerySql(question.sql, period),
    database: deployment.database,
    workgroup: deployment.workgroup,
  });

  assertReportQuerySucceeded(
    outcome,
    question.question.name,
    period,
    deployment,
  );

  return reportSection(
    {
      question: question.question,
      rule: question.rule,
      calculation: "period-query",
      sources: [periodQuerySpan(period)],
      value: reportRowsValue(outcome),
    },
    period,
  );
}
