// Calculating every section in one calendar report.

import type { ReportPeriod } from "../report-periods.js";
import type { ReportSection } from "../report-section-types.js";
import { reportSourceWindows } from "../report-source-windows.js";
import type { ReportDeployment } from "./report-deployment.js";
import { queriedRowsSection } from "./report-query-section.js";
import type { ReportQuestionRun, ReportRun } from "./report-run.js";
import type { ReportStore } from "./report-store.js";
import { summarizedRowsSection } from "./report-summary-section.js";
import { visitorSection } from "./report-visitor-section.js";

/** Every row section and optional visitor section in one report. */
export async function sectionsForReport(
  period: ReportPeriod,
  run: ReportRun,
  deployment: ReportDeployment,
  store: ReportStore,
  visitorSecret: string | undefined,
): Promise<readonly ReportSection[]> {
  const sections: ReportSection[] = [];

  for (const question of run.questions) {
    // Queries remain sequential so this job does not occupy several places
    // in the deployment's Athena workgroup at once.
    // oxlint-disable-next-line eslint/no-await-in-loop
    sections.push(await rowsSection(period, run, question, deployment, store));

    if (question.visitorSql !== undefined) {
      if (visitorSecret === undefined) {
        throw new Error(
          `The report question ${question.question.name} counts visitors,` +
            ` but this invocation read no visitor salt secret.`,
        );
      }

      // oxlint-disable-next-line eslint/no-await-in-loop
      const visitors = await visitorSection(
        period,
        question,
        deployment,
        visitorSecret,
      );
      sections.push(visitors);
    }
  }

  return sections;
}

/** One question's rows, from summaries where possible and raw otherwise. */
async function rowsSection(
  period: ReportPeriod,
  run: ReportRun,
  question: ReportQuestionRun,
  deployment: ReportDeployment,
  store: ReportStore,
): Promise<ReportSection> {
  const windows =
    question.calculation === "summaries"
      ? reportSourceWindows(period, run.granularities)
      : undefined;

  if (windows === undefined) {
    return queriedRowsSection(period, question, deployment);
  }

  return summarizedRowsSection(period, question, windows, store);
}
