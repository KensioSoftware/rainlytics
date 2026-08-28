// Settling the question a run is answered under, and stopping the runs the
// bucket cannot answer.
//
// A site that narrows a question used to say so three times. Once on
// `RollupQueries`, once on `RollupSummaries`, and again on every command line
// reading the answers back. The third copy is the one with nowhere to read
// from, and a deployment that changes its narrowing leaves every shell alias
// behind. A stored summary records the question it was computed with. The
// command reads that copy back, and the third one goes away.
//
// An option nobody named is the only kind taken. `rollupRequest` fills in a
// default for every field of every question, and by the time a
// `RollupRequest` exists a default and a value somebody chose are the same
// thing. `RollupAsked.named` carries the difference, read off the command line
// before the defaults go in.
//
// A named option that disagrees with the stored summaries is refused here too.
// Adoption fills gaps and never overrides one, and `refuseAnotherQuestion` at
// the foot of this file is the check that makes that safe to say.

import type { RollupSummary, SummaryQuestion } from "../rollup-summaries.js";
import type { Rollup } from "../rollups.js";
import type {
  CountingOption,
  NarrowingOption,
  StoredDisagreement,
} from "./summary-question.js";
import {
  narrowedBy,
  narrowingText,
  storedRowCount,
} from "./summary-narrowings.js";
import { countingOptions, questionDifferences } from "./summary-question.js";
import {
  answersSomethingElse,
  computedMoreThanOneWay,
} from "./summary-refusals.js";

/** What a run settled on, once the stored narrowing had been read. */
export interface AdoptedQuestion {
  /** The question the stored summaries are then checked against. */
  readonly question: SummaryQuestion;

  /**
   * The filters taken from them, as the command line that would have asked.
   *
   * In the order help prints the options, and empty on a run that narrowed
   * everything the summaries narrow.
   */
  readonly adopted: readonly string[];
}

/**
 * The question asked, with the filters nobody named taken from the summaries.
 *
 * A command line that counts nothing in particular is answered under the
 * narrowing its deployment declared, and {@link AdoptedQuestion.adopted} is
 * what standard error then says it took. A command line that narrows something
 * keeps what it was given, and `refuseAnotherQuestion` decides whether the
 * summaries hold that answer.
 *
 * @throws {Error} where the summaries counted a filter nobody named two ways.
 *   Taking one of the two would answer part of the span under a narrowing the
 *   rest was never computed with, and the question has to be settled before
 *   anything can be checked against it.
 */
export function adoptedQuestion(
  rollup: Rollup,
  asked: SummaryQuestion,
  named: ReadonlySet<NarrowingOption>,
  summaries: readonly RollupSummary[],
): AdoptedQuestion {
  const [first] = summaries;

  if (first === undefined) {
    return { question: asked, adopted: [] };
  }

  // The options some stored summary was computed with differently, which are
  // the only ones there is anything to take.
  const elsewhere = new Set(
    summaries
      .flatMap((summary) =>
        questionDifferences(rollup, asked, summary.question),
      )
      .map((difference) => difference.option),
  );
  const wanted = countingOptions.filter(
    (option) => !named.has(option) && elsewhere.has(option),
  );
  const disagreements = disagreedOn(rollup, wanted, first, summaries);

  if (disagreements.length > 0) {
    throw computedMoreThanOneWay(rollup, disagreements);
  }

  let question = asked;

  for (const option of wanted) {
    question = narrowedBy(option, question, first.question);
  }

  const cut = storedRowCount(rollup, asked, named, summaries);
  const adopted = wanted.map((option) => narrowingText(option, first.question));

  return cut === undefined
    ? { question, adopted }
    : {
        question: { ...question, limit: cut },
        adopted: [...adopted, `--limit ${String(cut)}`],
      };
}

/**
 * The options among `wanted` that the summaries answer two ways.
 *
 * Every summary is compared against `first`. Comparing `first` against itself
 * finds nothing, which is why it stays in the list it is compared against.
 *
 * `--limit` never reaches here. Two windows computed to different depths hold
 * one answer between them, being the shallower of the two, and
 * {@link storedRowCount} takes it.
 */
function disagreedOn(
  rollup: Rollup,
  wanted: readonly CountingOption[],
  first: RollupSummary,
  summaries: readonly RollupSummary[],
): readonly StoredDisagreement[] {
  const between = summaries.flatMap((other) =>
    questionDifferences(rollup, first.question, other.question),
  );

  return wanted.flatMap((option) => {
    const values = new Set(
      between
        .filter((difference) => difference.option === option)
        .flatMap((difference) => [difference.asked, difference.computed]),
    );

    return values.size === 0 ? [] : [{ option, computed: [...values] }];
  });
}

/**
 * Stops a run whose filters no stored summary was computed with.
 *
 * Every window is checked rather than the first alone. A deployment whose
 * question changed halfway through the span has summaries of both, and the
 * older half answers something the command line never asked.
 *
 * The question checked is the settled one. A filter the command line named is
 * still its own, and a filter taken from the summaries matches them by
 * construction.
 *
 * @throws {Error} naming every option a reader would have to change.
 */
export function refuseAnotherQuestion(
  rollup: Rollup,
  question: SummaryQuestion,
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
