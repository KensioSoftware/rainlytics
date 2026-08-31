// A distinct visitor section queried over one calendar report period.

import { runAthenaQuery } from "../athena/athena-query.js";
import type { ReportPeriod } from "../report-periods.js";
import { periodQuerySpan, periodQuerySql } from "../report-period-query.js";
import type { ReportSection } from "../report-section-types.js";
import { reportSection } from "../report-sections.js";
import { visitorColumn } from "../visitor-counts.js";
import { saltedSql } from "../visitor-identity.js";
import type { ReportDeployment } from "./report-deployment.js";
import { assertReportQuerySucceeded } from "./report-query-result.js";
import type { ReportQuestionRun } from "./report-run.js";
import { reportVisitorSalt } from "./visitor-salt.js";

/** A period-wide distinct visitor count under one period salt. */
export async function visitorSection(
  period: ReportPeriod,
  question: ReportQuestionRun,
  deployment: ReportDeployment,
  secret: string,
): Promise<ReportSection> {
  const sql = saltedSql(
    periodQuerySql(String(question.visitorSql), period),
    reportVisitorSalt(secret, period),
  );
  const outcome = await runAthenaQuery({
    sql,
    database: deployment.database,
    workgroup: deployment.workgroup,
  });

  assertReportQuerySucceeded(
    outcome,
    `visitors for ${question.question.name}`,
    period,
    deployment,
  );

  const counted = outcome.rows[0]?.[visitorColumn];

  if (
    counted === undefined ||
    !/^\d+$/u.test(counted) ||
    !Number.isSafeInteger(Number(counted))
  ) {
    throw new Error(
      `The visitor count for ${question.question.name} in the` +
        ` ${period.unit} starting ${period.startsOn} came back as` +
        ` ${JSON.stringify(counted)}, which is not a number of visitors.`,
    );
  }

  return reportSection(
    {
      question: question.question,
      rule: "visitor-count",
      calculation: "period-query",
      sources: [periodQuerySpan(period)],
      value: {
        type: "visitor-count",
        count: { distinct: Number(counted), additive: false },
      },
    },
    period,
  );
}
