// What each narrowing option does to the question a summary records.
//
// The join between an option a reader types and a field of `SummaryQuestion`.
// `summary-adoption.ts` walks it to take the filters a command line left out,
// and to spell each one back the way it would have arrived.
//
// Written out one option at a time rather than derived. The fields are named
// here. A field that leaves `RollupRequest` stops this compiling, and a reader
// can see what `--redirect-status` does to a question without following a
// lookup.

import type { SummaryQuestion } from "../rollup-summaries.js";
import type { NarrowingOption } from "./summary-question.js";

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
const narrowings: Readonly<Record<NarrowingOption, Narrowing>> = {
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
  "--limit": {
    taken: (asked, stored) => ({ ...asked, limit: stored.limit }),
    value: (stored) => String(stored.limit),
  },
};

/** One question, with one option's value taken from a stored summary. */
export function narrowedBy(
  option: NarrowingOption,
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
  option: NarrowingOption,
  stored: SummaryQuestion,
): string {
  const value = narrowings[option].value?.(stored);

  return value === undefined ? option : `${option} ${value}`;
}
