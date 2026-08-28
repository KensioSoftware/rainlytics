// Answering one named question out of the precomputed summaries.
//
// This is the read path `AGENTS.md` has promised since M2. Athena is the batch
// engine that computes a summary and the tool a person reaches for with a
// one-off question, and it answers no repeated question. A command that
// dropped back to a query when a summary was missing would put the cost back
// without anybody choosing it, so every case that cannot be answered from the
// bucket says what it found and names `--query`.
//
// The steps are in three files around this one. `summary-coverage.ts` picks
// the windows, `summary-covering.ts` fetches them and decides what a gap
// means, and `summary-question.ts` decides whether what came back answers the
// question that was asked.

import type { RollupSummary } from "../rollup-summaries.js";
import type { Rollup } from "../rollups.js";
import { summaryCoverage } from "../summary-coverage.js";
import { totalledRows } from "../summary-totals.js";
import type { CliIo } from "./io.js";
import type { CommandResult } from "./output/result.js";
import type { RollupAsked } from "./rollup-options.js";
import { summaryCovering } from "./summary-covering.js";
import { askedQuestion, questionDifferences } from "./summary-question.js";
import {
  answersSomethingElse,
  doesNotAdd,
  noWholeWindow,
  nowhereToRead,
} from "./summary-refusals.js";
import { summaryReport } from "./summary-report.js";

/**
 * One question, answered from the bucket a schedule writes to.
 *
 * @throws {UsageError} where nothing says which bucket to read, or where the
 *   span asked for holds no whole stored window.
 * @throws {Error} where the windows were never computed, where the stored
 *   summaries answer a different question, or where several windows answered
 *   a question whose rows do not add.
 */
export async function summaryRows(
  rollup: Rollup,
  asked: RollupAsked,
  io: CliIo,
): Promise<CommandResult> {
  const bucket = asked.summaries;

  if (bucket === undefined) {
    throw nowhereToRead(rollup);
  }

  const question = askedQuestion(rollup, asked.request);
  const windows = summaryCoverage(asked.range);

  if (windows.length === 0) {
    throw noWholeWindow(rollup);
  }

  const covering = await summaryCovering(
    { bucket, region: asked.region },
    question,
    windows,
  );

  refuseAnotherQuestion(rollup, question, covering.summaries);

  io.error(
    summaryReport({
      bucket,
      name: rollup.name,
      summaries: covering.summaries,
      missing: covering.missing,
      gets: covering.gets,
      isRanked: rollup.isRanked,
      at: new Date(),
    }),
  );

  return answerFrom(rollup, asked, covering.summaries);
}

/**
 * The rows of one window, or the windows added together.
 *
 * One window comes back in the order it was written, cut to the row count
 * that was asked for. Nothing is grouped or re-ordered, so a pipeline reading
 * the JSON sees what the query would have answered. The cut matters where a
 * deployment computes deeper than a command asks. The top twenty of a stored
 * hundred are the top twenty.
 */
function answerFrom(
  rollup: Rollup,
  asked: RollupAsked,
  summaries: readonly RollupSummary[],
): CommandResult {
  // Every window of one question names the same columns, so the set of them
  // is those columns in the order they were written.
  const columns = [...new Set(summaries.flatMap((summary) => summary.columns))];
  const rows = summaries.flatMap((summary) => summary.rows);

  if (summaries.length === 1) {
    return {
      columns,
      rows: rollup.isRanked ? rows.slice(0, asked.request.limit) : rows,
    };
  }

  if (rollup.totals === undefined) {
    throw doesNotAdd(rollup, summaries.length);
  }

  return {
    columns,
    rows: [
      ...totalledRows(
        summaries,
        rollup.totals,
        rollup.isRanked ? asked.request.limit : undefined,
      ),
    ],
  };
}

/**
 * Stops a run whose filters no stored summary was computed with.
 *
 * Every window is checked rather than the first alone. A deployment whose
 * question changed halfway through the span has summaries of both, and the
 * older half answers something the command line never asked.
 */
function refuseAnotherQuestion(
  rollup: Rollup,
  question: ReturnType<typeof askedQuestion>,
  summaries: readonly RollupSummary[],
): void {
  const differences = new Map(
    summaries
      .flatMap((summary) =>
        questionDifferences(rollup, question, summary.question),
      )
      .map((difference) => [difference.option, difference]),
  );

  if (differences.size > 0) {
    throw answersSomethingElse(rollup, [...differences.values()]);
  }
}
