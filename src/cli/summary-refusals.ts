// What a command says where the bucket cannot answer the question.
//
// Every one of these ends the run and names `--query`. A named question that
// dropped back to Athena on its own would put the cost of a query back without
// anybody choosing it, which is the shape `AGENTS.md` rules out and the reason
// KensioSoftware/rainlytics#56 exists.
//
// Apart from `summary-answer.ts` for the reason `help-text.ts` is apart from
// `help.ts`. These are sentences somebody reads at a terminal after a command
// gave them nothing, and they are meant to be edited as prose.

import type { Rollup } from "../rollups.js";
import { coveredSpan } from "../summary-coverage.js";
import type { SummaryWindow } from "../summary-windows.js";
import { summarySpan } from "../summary-windows.js";
import { UsageError } from "./failure.js";
import { summaryBucketVariable } from "./summary-help.js";
import type {
  QuestionDifference,
  StoredDisagreement,
} from "./summary-question.js";

/** What a reader is told where nothing says which bucket holds the answers. */
export function nowhereToRead(rollup: Rollup): UsageError {
  return new UsageError(
    `${rollup.name} reads a precomputed summary, and nothing has said where` +
      ` the summaries are. Name the bucket with --summaries, or put it in` +
      ` ${summaryBucketVariable}. The RollupSummaries construct creates one` +
      ` and writes into it. --query answers this from Athena instead, at the` +
      ` cost a query reports.`,
    rollup.name,
  );
}

/** What a reader is told where the span holds no whole stored window. */
export function noWholeWindow(rollup: Rollup): UsageError {
  return new UsageError(
    `That span holds no whole stored window. Summaries cover UTC hours and` +
      ` UTC days, and the hour running now is still filling, so a span under` +
      ` two hours can fall inside one window and cover none of it. Ask for` +
      ` longer, or run the question with --query.`,
    rollup.name,
  );
}

/**
 * What a reader is told where the stored summaries answer something else.
 *
 * The differences are printed one to a line, each naming the option a reader
 * would change. Somebody who asked for one host and met summaries counting
 * every host can see which of the two to move.
 */
export function answersSomethingElse(
  rollup: Rollup,
  differences: readonly QuestionDifference[],
): Error {
  const lines = differences.map(
    (difference) =>
      `  ${difference.option}: asked for ${difference.asked}, computed with` +
      ` ${difference.computed}`,
  );

  return new Error(
    `The stored ${rollup.name} summaries answer a different question.\n` +
      `${lines.join("\n")}\n` +
      `A schedule computes the questions its deployment named, and the` +
      ` requests prop on RollupSummaries is where a narrowed one is added.` +
      ` --query answers this run from Athena at the cost a query reports.`,
  );
}

/**
 * What a reader is told where the stored summaries were narrowed two ways.
 *
 * A command line naming no filters takes the ones its deployment declared, and
 * this is the span where there is more than one answer to take. A deployment
 * that changed its `requests` halfway through has summaries of both questions,
 * and an answer assembled from them would cover part of the span under a
 * narrowing the rest was never computed with.
 *
 * The reader settles it by typing the one they want. Every window the run
 * still disagrees with is then named by {@link answersSomethingElse}. That is
 * the same conversation from the other end.
 */
export function computedMoreThanOneWay(
  rollup: Rollup,
  disagreements: readonly StoredDisagreement[],
): Error {
  const lines = disagreements.map(
    (disagreement) =>
      `  ${disagreement.option}: some windows computed with` +
      ` ${disagreement.computed.join(", others with ")}`,
  );

  return new Error(
    `The stored ${rollup.name} summaries over that span were not all` +
      ` computed the same way, and this run named nothing to settle it` +
      ` with.\n${lines.join("\n")}\nA deployment that changed its requests` +
      ` prop leaves both questions in the bucket. Name the one you want on` +
      ` the command line, ask about a span on one side of the change, or run` +
      ` it with --query.`,
  );
}

/** What a reader is told where a question's rows cannot be added up. */
export function doesNotAdd(rollup: Rollup, windows: number): Error {
  return new Error(
    `${rollup.name} answers over one stored window, and that span covers` +
      ` ${String(windows)}. A rollup says how its rows add across windows` +
      ` with the totals field, and one that says nothing is left alone` +
      ` rather than added up wrongly. Ask about a shorter span, or run it` +
      ` with --query.`,
  );
}

/** What a reader is told where no window in the range has been computed. */
export function nothingComputed(windows: readonly SummaryWindow[]): Error {
  const span = coveredSpan(windows);

  return new Error(
    `No summary covers ${span.from} to ${span.until}. Nothing has computed` +
      ` those windows. The RollupSummaries construct computes them on a` +
      ` schedule` +
      ` and reaches back no further than its own deployment, and --query` +
      ` answers this from Athena at the cost a query reports.`,
  );
}

/** What a reader is told where one window inside the span is missing. */
export function holeIn(window: SummaryWindow): Error {
  const span = summarySpan(window);

  return new Error(
    `The ${span.granularity} window opening ${span.from} has no summary,` +
      ` and the windows either side of it do. An answer skipping it would be` +
      ` short by a whole window with nothing in the rows to say so. That` +
      ` window is a run that failed, and the function's log group has why.` +
      ` --query answers the whole span from Athena.`,
  );
}
