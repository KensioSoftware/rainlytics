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
  NarrowingOption,
  StoredDisagreement,
} from "./summary-question.js";
import { narrowedBy, narrowingText } from "./summary-narrowings.js";
import { narrowingOptions, questionDifferences } from "./summary-question.js";
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
 * A command line that narrows nothing is answered under the narrowing its
 * deployment declared, and {@link AdoptedQuestion.adopted} is what standard
 * error then says it took. A command line that narrows something keeps what it
 * was given, and `refuseAnotherQuestion` decides whether the summaries hold
 * that answer.
 *
 * @throws {Error} where the summaries answer a filter nobody named two ways.
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

  const elsewhere = storedElsewhere(rollup, asked, summaries);
  const wanted = narrowingOptions.filter(
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

  return {
    question,
    adopted: wanted.map((option) => narrowingText(option, first.question)),
  };
}

/** The options any stored summary was computed with differently. */
function storedElsewhere(
  rollup: Rollup,
  asked: SummaryQuestion,
  summaries: readonly RollupSummary[],
): ReadonlySet<NarrowingOption> {
  return new Set(
    summaries
      .flatMap((summary) =>
        questionDifferences(rollup, asked, summary.question),
      )
      .map((difference) => difference.option),
  );
}

/**
 * The options among `wanted` that the summaries answer two ways.
 *
 * Every summary is compared against `first`, both ways round, since `--limit`
 * reports a difference in one direction alone. A window computed with the top
 * hundred rows covers a run asking for twenty, and a window computed with the
 * top one does not. Comparing `first` against itself finds nothing, which is
 * why it stays in the list it is compared against.
 */
function disagreedOn(
  rollup: Rollup,
  wanted: readonly NarrowingOption[],
  first: RollupSummary,
  summaries: readonly RollupSummary[],
): readonly StoredDisagreement[] {
  const found = new Map<NarrowingOption, Set<string>>();

  for (const other of summaries) {
    const between = [
      ...questionDifferences(rollup, first.question, other.question),
      ...questionDifferences(rollup, other.question, first.question),
    ];

    for (const difference of between) {
      const values = found.get(difference.option) ?? new Set<string>();

      found.set(
        difference.option,
        values.add(difference.asked).add(difference.computed),
      );
    }
  }

  return wanted.flatMap((option) => {
    const values = found.get(option);

    return values === undefined ? [] : [{ option, computed: [...values] }];
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
