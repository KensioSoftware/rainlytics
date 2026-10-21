// One window of one question, computed and written.
//
// Apart from the handler because a scheduled run and a backfill both come
// through here. The window decides the key and the SQL, and nothing else about
// the run that asked for it changes what is written.

import { runAthenaQuery } from "../athena/athena-query.js";
import { summaryKey } from "../rollup-summaries.js";
import { windowedSql } from "../summary-runs.js";
import type { SummaryWindow } from "../summary-windows.js";
import type { SummaryDeployment } from "./summary-deployment.js";
import { summaryDocument } from "./summary-document.js";
import { summaryFailure } from "./summary-failure.js";
import type { SummaryRun } from "./summary-run.js";
import type { SummaryStore } from "./summary-store.js";
import type { VisitorRun } from "./summary-visitors.js";
import { visitorsIn } from "./summary-visitors.js";

/**
 * One window, computed and written.
 *
 * Sequential rather than all at once. The windows of one run differ only by a
 * partition predicate, so running them together would put several copies of
 * one question in front of the workgroup at the same moment for no gain worth
 * having. Athena queues concurrent queries per account, and a job holding
 * places in that queue is a job competing with whoever is asking a question
 * at their terminal.
 */
export async function computeWindow(
  run: SummaryRun,
  window: SummaryWindow,
  deployment: SummaryDeployment,
  store: SummaryStore,
  counting: VisitorRun | undefined,
): Promise<void> {
  const outcome = await runAthenaQuery({
    sql: windowedSql(run.sql, window),
    database: deployment.database,
    workgroup: deployment.workgroup,
  });

  if (outcome.state !== "SUCCEEDED") {
    throw summaryFailure(
      outcome,
      `${run.question.name} for ${window.at.toISOString()}`,
      deployment.workgroup,
    );
  }

  // After the question and not beside it, for the reason above. Two queries
  // of one window in front of the workgroup at once is the same competition
  // with whoever is asking a question at their terminal.
  const visitors = await visitorsIn(counting, window, deployment);

  await store.write(
    summaryKey(run.question, window),
    summaryDocument(run.question, window, outcome, new Date(), visitors),
  );
}
