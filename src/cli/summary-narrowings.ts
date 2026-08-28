// What each counting option does to the question a summary records.
//
// The join between an option a reader types and a field of `SummaryQuestion`.
// `summary-adoption.ts` walks it to take the filters a command line left out,
// and to spell each one back the way it would have arrived.
//
// `--limit` has no entry in that table. It sets no filter on what was counted,
// and `storedRowCount` at the foot of this file works it out from the stored
// windows instead.
//
// Written out one option at a time rather than derived. The fields are named
// here. A field that leaves `RollupRequest` stops this compiling, and a reader
// can see what `--redirect-status` does to a question without following a
// lookup.

import type { RollupSummary, SummaryQuestion } from "../rollup-summaries.js";
import type { Rollup } from "../rollups.js";
import type { CountingOption, NarrowingOption } from "./summary-question.js";

/** How one option reaches the question a summary records. */
interface Narrowing {
  /** The asked question, with this option taken from a stored one. */
  readonly taken: (
    asked: SummaryQuestion,
    stored: SummaryQuestion,
  ) => SummaryQuestion;

  /** What a reader would have given the option. Absent for a flag. */
  readonly value?: (stored: SummaryQuestion) => string | undefined;
}

/** Each option, as the field it sets and the value a reader would type. */
const narrowings: Readonly<Record<CountingOption, Narrowing>> = {
  "--host": {
    taken: (asked, stored) => ({ ...asked, host: stored.host }),
    value: (stored) => stored.host,
  },
  "--path": {
    taken: (asked, stored) => ({ ...asked, paths: stored.paths }),
    value: (stored) => stored.paths?.join(" "),
  },
  "--include-bots": {
    taken: (asked, stored) => ({ ...asked, includeBots: stored.includeBots }),
  },
  "--param": {
    taken: (asked, stored) => ({ ...asked, param: stored.param }),
    value: (stored) => stored.param,
  },
  "--redirect-status": {
    taken: (asked, stored) => ({
      ...asked,
      redirectStatuses: stored.redirectStatuses,
    }),
    value: (stored) => stored.redirectStatuses.join(","),
  },
};

/** One question, with one option's value taken from a stored summary. */
export function narrowedBy(
  option: CountingOption,
  asked: SummaryQuestion,
  stored: SummaryQuestion,
): SummaryQuestion {
  return narrowings[option].taken(asked, stored);
}

/**
 * One stored option, as the command line that would have asked for it.
 *
 * `--path /liju/search/ /cidian/search/` for a list, and `--include-bots` on
 * its own for a flag. A reader copies the line onto a command of their own,
 * and a reporter prints it without knowing how any option is spelled.
 */
export function narrowingText(
  option: CountingOption,
  stored: SummaryQuestion,
): string {
  const value = narrowings[option].value?.(stored);

  return value === undefined ? option : `${option} ${value}`;
}

/**
 * The row count a run that named none answers with, where it is not the
 * command's own default.
 *
 * The smallest of the stored windows, and nothing where every one of them
 * reaches the default. A row count decides how much of a ranked answer is
 * printed and leaves what was counted where it was. A deployment computing the
 * top hundred still answers a bare `rainlytics pageviews` with the top twenty,
 * and the stored hundred holds them.
 *
 * A window holding fewer rows than that is the case worth reporting. Nineteen
 * rows nobody counted cannot be recovered from a stored answer holding one,
 * and the honest answer is the one row with a line saying so. A run that typed
 * the count is refused instead, by `refuseAnotherQuestion`.
 */
export function storedRowCount(
  rollup: Rollup,
  asked: SummaryQuestion,
  named: ReadonlySet<NarrowingOption>,
  summaries: readonly RollupSummary[],
): number | undefined {
  if (!rollup.isRanked || named.has("--limit")) {
    return undefined;
  }

  const deepest = Math.min(
    ...summaries.map((summary) => summary.question.limit),
  );

  return deepest < asked.limit ? deepest : undefined;
}
