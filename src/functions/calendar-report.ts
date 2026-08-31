// The scheduled job that writes closed calendar report documents.

import { reportDocument } from "../report-document.js";
import { reportKey } from "../report-key.js";
import { closingReportPeriods } from "./report-periods.js";
import { reportDeploymentFrom } from "./report-deployment.js";
import { reportRunFrom } from "./report-run.js";
import { sectionsForReport } from "./report-sections.js";
import { openReportStore } from "./report-store.js";
import { visitorSecret } from "./visitor-salt.js";

/** One daily firing of the calendar report schedule. */
export async function handler(event: unknown): Promise<void> {
  const deployment = reportDeploymentFrom(process.env);
  const run = reportRunFrom(event);
  const now = new Date();
  const periods = closingReportPeriods(
    now,
    run.timeZone,
    run.weekStartsOn,
    run.recomputedDays,
  );
  const secret = run.questions.some(
    (question) => question.visitorSql !== undefined,
  )
    ? await visitorSecret(deployment.visitorSaltParameter)
    : undefined;
  const store = await openReportStore(deployment.bucket);
  const failures: Error[] = [];

  try {
    for (const period of periods) {
      try {
        // Periods and queries are sequential. One invocation never competes
        // with itself for the workgroup's query slots.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const sections = await sectionsForReport(
          period,
          run,
          deployment,
          store,
          secret,
        );
        const document = reportDocument({
          period,
          computedAt: new Date(),
          sections,
        });

        // oxlint-disable-next-line eslint/no-await-in-loop
        await store.write(reportKey(period), document);
      } catch (error) {
        failures.push(
          new Error(
            `The ${period.unit} report starting ${period.startsOn} failed.`,
            { cause: error },
          ),
        );
      }
    }
  } finally {
    store.close();
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${String(failures.length)} calendar report(s) failed.`,
    );
  }
}
