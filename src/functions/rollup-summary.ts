// The scheduled job, which is one question answered over the windows that
// have just closed.
//
// Athena does the counting. This starts a query, waits for it, and writes
// what came back to S3. A handler that read rows and aggregated them itself
// would be a second batch engine in a pipeline that already has one, and it
// would be the half nobody sized. `AGENTS.md` has the constraint.
//
// One invocation answers one question on one cadence. `RollupSummaries`
// writes a schedule per question per granularity, so a question that fails
// takes its own run down and leaves the others computing.

import { runAthenaQuery } from "../athena/athena-query.js";
import { summaryKey } from "../rollup-summaries.js";
import { recomputedWindows, windowedSql } from "../summary-runs.js";
import type { SummaryWindow } from "../summary-windows.js";
import { summaryDocument } from "./summary-document.js";
import { summaryFailure } from "./summary-failure.js";
import type { SummaryDeployment } from "./summary-deployment.js";
import { deploymentFrom } from "./summary-deployment.js";
import type { SummaryRun } from "./summary-run.js";
import { runFrom } from "./summary-run.js";
import type { SummaryStore } from "./summary-store.js";
import { openSummaryStore } from "./summary-store.js";
import { runSecret, visitorsIn } from "./summary-visitors.js";

/**
 * One firing of one schedule.
 *
 * The windows are worked out from the clock rather than from anything the
 * schedule sent. A run that started late computes the same windows a punctual
 * one would, and a run that fired twice writes the same objects twice.
 *
 * @throws {Error} for a query that did not succeed, which is what puts a
 *   failed run on the function's error metric and in its log group.
 */
export async function handler(event: unknown): Promise<void> {
  const deployment = deploymentFrom(process.env);
  const run = runFrom(event);
  // Before anything is queried. A run whose salt is unreachable fails saying
  // so rather than after paying Athena for a window it will not write.
  const secret = await runSecret(run, deployment);
  const store = await openSummaryStore(deployment.bucket);

  try {
    for (const window of recomputedWindows(
      new Date(),
      run.granularity,
      deployment.windows,
    )) {
      // One at a time, which `computeWindow` explains.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await computeWindow(run, window, deployment, store, secret);
    }
  } finally {
    store.close();
  }
}

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
async function computeWindow(
  run: SummaryRun,
  window: SummaryWindow,
  deployment: SummaryDeployment,
  store: SummaryStore,
  secret: string | undefined,
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
  const visitors = await visitorsIn(run, window, deployment, secret);

  await store.write(
    summaryKey(run.question, window),
    summaryDocument(run.question, window, outcome, new Date(), visitors),
  );
}
