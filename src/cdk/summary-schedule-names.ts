// The logical ids the schedules take, and the pairs that cannot share one.

import type { SummaryRun } from "../functions/summary-run.js";
import type { Rollup } from "../rollups.js";
import type { SummaryGranularity } from "../summary-windows.js";
import { queryId } from "./saved-query-names.js";

/**
 * The logical id one schedule takes within the construct.
 *
 * Built from the question and the cadence, so a question added to a
 * deployment leaves every other schedule's id alone. An id derived from
 * position in a list would renumber the schedules after it, and
 * CloudFormation would replace resources nothing had changed.
 */
export function scheduleId(run: SummaryRun): string {
  return `${queryId(run.question.name)}${queryId(run.granularity)}`;
}

/**
 * Refuses two questions scheduled under one name.
 *
 * A summary's key is built from the question's name and its window, so two
 * questions of one name write to one key and each run overwrites the other's
 * answer. Whichever ran last is the one a reader gets, and neither the key
 * nor the schedule says the pair exists. `RollupQueries` refuses the same
 * pair for the same kind of reason.
 *
 * @throws {Error} naming the questions that collide.
 */
export function assertOneSummaryEach(computing: readonly Rollup[]): void {
  const names = computing.map((rollup) => rollup.name);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);

  if (repeated !== undefined) {
    throw new Error(
      `More than one rollup is called "${repeated}", and both would write` +
        ` their summaries to the same key. Whichever ran last would be the` +
        ` answer, and nothing in the key or the document would say the other` +
        ` had been computed. Where one of them replaces a built-in question,` +
        ` leave the built-in out: rollups:` +
        ` [...rollups.filter((rollup) => rollup.name !== "${repeated}"),` +
        ` my${queryId(repeated)}]`,
    );
  }
}

/**
 * Refuses a set of questions or windows that would compute nothing.
 *
 * Both lists default to something when they are left out, and an empty one is
 * not left out. `rollups: []` and `granularities: []` each deploy a function
 * nothing invokes, a bucket nothing writes to and no schedules at all, and
 * the stack reports success.
 *
 * @throws {Error} naming the empty list and what leaving it out would do.
 */
export function assertSomethingToCompute(
  computing: readonly Rollup[],
  granularities: readonly SummaryGranularity[],
): void {
  if (computing.length === 0) {
    throw new Error(
      `A deployment computing no questions computes nothing. Leave rollups` +
        ` out for the ones Rainlytics ships, or name at least one.`,
    );
  }

  if (granularities.length === 0) {
    throw new Error(
      `A deployment computing no granularity computes nothing. Leave` +
        ` granularities out for hours and days, or name at least one.`,
    );
  }
}
