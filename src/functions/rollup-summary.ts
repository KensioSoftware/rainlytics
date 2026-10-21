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
//
// A payload carrying a `backfill` range is somebody filling in windows the
// schedule never wrote. It computes the windows of that range rather than the
// ones the clock names, through the same `computeWindow`, so a backfilled
// summary is the object the scheduled run would have written.

import type { BackfillProgress } from "../summary-backfill.js";
import { recomputedWindows } from "../summary-runs.js";
import type { SummaryGranularity, SummaryWindow } from "../summary-windows.js";
import { backfillFrom } from "./summary-backfill-input.js";
import type { InvocationTime } from "./summary-backfill-run.js";
import { backfill } from "./summary-backfill-run.js";
import { deploymentFrom } from "./summary-deployment.js";
import { runFrom } from "./summary-run.js";
import { openSummaryStore } from "./summary-store.js";
import { visitorRunFor } from "./summary-visitors.js";
import { computeWindow } from "./summary-window.js";

/**
 * One firing of one schedule, or one stretch of a backfill.
 *
 * A scheduled run works its windows out from the clock rather than from
 * anything the schedule sent. A run that started late computes the same
 * windows a punctual one would, and a run that fired twice writes the same
 * objects twice. It answers with nothing.
 *
 * A backfill computes the closed windows of the range it names, oldest first,
 * for as long as the invocation has time. It answers with the windows it
 * wrote and, where the range is not finished, the payload to invoke with
 * next. `summary-backfill-run.ts` has why the caller carries on rather than
 * the function.
 *
 * @throws {Error} for a query that did not succeed, which is what puts a
 *   failed run on the function's error metric and in its log group.
 */
export async function handler(
  event: unknown,
  context?: InvocationTime,
): Promise<BackfillProgress | undefined> {
  const deployment = deploymentFrom(process.env);
  const run = runFrom(event);
  const range = backfillFrom(event);
  // Before anything is queried. A run whose salt is unreachable fails saying
  // so rather than after paying Athena for a window it will not write.
  const counting = await visitorRunFor(run, deployment);
  const store = await openSummaryStore(deployment.bucket);
  const compute = async (window: SummaryWindow): Promise<void> => {
    await computeWindow(run, window, deployment, store, counting);
  };

  try {
    if (range === undefined) {
      await computeRecomputed(run.granularity, deployment.windows, compute);
      return undefined;
    }

    return await backfill(
      { payload: event, range, granularity: run.granularity, compute },
      context,
    );
  } finally {
    store.close();
  }
}

/** The windows a scheduled run names from the clock, newest first. */
async function computeRecomputed(
  granularity: SummaryGranularity,
  count: number,
  compute: (window: SummaryWindow) => Promise<void>,
): Promise<void> {
  for (const window of recomputedWindows(new Date(), granularity, count)) {
    // One at a time, which `computeWindow` explains.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await compute(window);
  }
}
