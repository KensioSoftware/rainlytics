// Answering one named question out of the precomputed summaries.
//
// This is the read path `AGENTS.md` has promised since M2. Athena is the batch
// engine that computes a summary and the tool a person reaches for with a
// one-off question, and it answers no repeated question. A command that
// dropped back to a query when a summary was missing would put the cost back
// without anybody choosing it, so every case that cannot be answered from the
// bucket says what it found and names `--query`.
//
// The steps are in the files around this one. `summary-coverage.ts` picks the
// windows, `summary-covering.ts` fetches them and decides what a gap means,
// `summary-question.ts` compares what came back against what was asked, and
// `summary-adoption.ts` settles the question a run is answered under and stops
// the runs no stored summary covers.

import type { RollupSummary, SummaryQuestion } from "../rollup-summaries.js";
import type { Rollup } from "../rollups.js";
import { summaryCoverage } from "../summary-coverage.js";
import { totalledRows } from "../summary-totals.js";
import type { CliIo } from "./io.js";
import type { CommandResult } from "./output/result.js";
import type { RollupAsked } from "./rollup-options.js";
import { adoptedQuestion, refuseAnotherQuestion } from "./summary-adoption.js";
import { summaryCovering } from "./summary-covering.js";
import { askedQuestion } from "./summary-question.js";
import {
  doesNotAdd,
  noWholeWindow,
  nowhereToRead,
} from "./summary-refusals.js";
import { summaryReport } from "./summary-report.js";

/**
 * One question, answered from the bucket a schedule writes to.
 *
 * A run that named no filters of its own is answered under the narrowing the
 * summaries were computed with, and standard error says which filters it took.
 * A site declares its narrowing on `RollupSummaries` and the command line
 * reads that copy back. A shell alias never has to carry a second one.
 *
 * @throws {UsageError} where nothing says which bucket to read, or where the
 *   span asked for holds no whole stored window.
 * @throws {Error} where the windows were never computed, where the stored
 *   summaries answer a different question, where the span was computed more
 *   than one way, or where several windows answered a question whose rows do
 *   not add.
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
  const settled = adoptedQuestion(
    rollup,
    question,
    asked.named,
    covering.summaries,
  );

  refuseAnotherQuestion(rollup, settled.question, covering.summaries);

  io.error(
    summaryReport({
      bucket,
      name: rollup.name,
      summaries: covering.summaries,
      missing: covering.missing,
      gets: covering.gets,
      adopted: settled.adopted,
      isRanked: rollup.isRanked,
      at: new Date(),
    }),
  );

  return answerFrom(rollup, settled.question, covering.summaries);
}

/**
 * The rows of one window, or the windows added together.
 *
 * One window comes back in the order it was written, cut to the row count the
 * settled question carries. Nothing is grouped or re-ordered, so a pipeline
 * reading the JSON sees what the query would have answered. The cut matters
 * where a deployment computes deeper than a command asks. The top twenty of a
 * stored hundred are the top twenty.
 */
function answerFrom(
  rollup: Rollup,
  question: SummaryQuestion,
  summaries: readonly RollupSummary[],
): CommandResult {
  // Every window of one question names the same columns, so the set of them
  // is those columns in the order they were written.
  const columns = [...new Set(summaries.flatMap((summary) => summary.columns))];
  const rows = summaries.flatMap((summary) => summary.rows);

  if (summaries.length === 1) {
    return {
      columns,
      rows: rollup.isRanked ? rows.slice(0, question.limit) : rows,
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
        rollup.isRanked ? question.limit : undefined,
      ),
    ],
  };
}
