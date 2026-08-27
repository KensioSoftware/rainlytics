// Turning the questions a deployment was given into the runs its schedules
// carry.

import type { SummaryRun } from "../functions/summary-run.js";
import type { Rollup, RollupRequest } from "../rollups.js";
import {
  assertRollupName,
  rollupRequest,
  rollupSql,
  summarisedWindow,
} from "../rollups.js";
import type { LogDataset } from "../dataset.js";
import type { SummaryGranularity } from "../summary-windows.js";
import type { SavedRollupRequest } from "./rollup-queries.js";

/** What the runs of one deployment are built from. */
export interface SummaryQuestions {
  /** The questions to compute. */
  readonly rollups: readonly Rollup[];

  /** The windows to compute them over. */
  readonly granularities: readonly SummaryGranularity[];

  /** The table they read. */
  readonly dataset: LogDataset;

  /** What each question covers, by the name of its rollup. */
  readonly requests?: Readonly<Record<string, SavedRollupRequest>> | undefined;
}

/**
 * Every question on every cadence, one run each.
 *
 * Grouped by cadence rather than by question, so the hourly schedules of a
 * deployment sit together in the template the way they sit together in the
 * console.
 */
export function summaryRuns(
  questions: SummaryQuestions,
): readonly SummaryRun[] {
  return questions.granularities.flatMap((granularity) =>
    questions.rollups.map((rollup) => runFor(rollup, granularity, questions)),
  );
}

/** One question on one cadence, as the schedule hands it to the job. */
function runFor(
  rollup: Rollup,
  granularity: SummaryGranularity,
  questions: SummaryQuestions,
): SummaryRun {
  assertRollupName(rollup.name);

  // The range and the dataset come last, for the reason `RollupQueries`
  // gives. A caller reaching past the type then cannot point a scheduled
  // query at a table this deployment never created, or bake a span into a
  // query that runs every hour.
  const request = rollupRequest({
    ...questions.requests?.[rollup.name],
    range: summarisedWindow,
    dataset: questions.dataset,
  });

  return {
    question: { name: rollup.name, ...withoutRange(request) },
    granularity,
    sql: rollupSql(rollup, request),
  };
}

/**
 * The request as a summary's document records it.
 *
 * The range is left out because the window is the range, and the dataset
 * because every summary in one bucket came from one table. `SummaryQuestion`
 * says the same thing as a type.
 */
function withoutRange(
  request: RollupRequest,
): Omit<RollupRequest, "dataset" | "range"> {
  const { dataset: _dataset, range: _range, ...question } = request;

  return question;
}
