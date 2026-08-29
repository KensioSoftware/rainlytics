// Which questions a deployment computes, given what its table carries.
//
// Apart from `summary-configuration.ts` because it answers one question that
// nothing else in the settling has to think about. Every other choice a
// deployment makes is between what it was told and a default. This one is
// between what it was told and what the delivered field set can support.

import { countsVisitorsFrom, visitorAddressField } from "../log-fields.js";
import { type Rollup, withoutVisitorCount } from "../rollups.js";
import { rollups } from "../rollup-questions.js";
import type { RollupSummariesProps } from "./summary-configuration.js";

/**
 * The questions this deployment computes, against the table it reads.
 *
 * A visitor count is the one question needing a field the delivery can be
 * configured without. The shipped questions therefore follow the table. A
 * deployment over a table carrying no viewer address gets the same five
 * questions with the count off, and needs no salt for them.
 *
 * A caller that asked for the count by name gets an error instead. Dropping
 * what it asked for would leave a deployment computing something other than
 * what its code says.
 *
 * @throws {Error} where a named question counts visitors the table cannot
 *   identify.
 */
export function computedQuestions(
  props: RollupSummariesProps,
): readonly Rollup[] {
  if (countsVisitorsFrom(props.table.fields)) {
    return props.rollups ?? rollups;
  }

  if (props.rollups === undefined) {
    return rollups.map((rollup) => withoutVisitorCount(rollup));
  }

  assertNothingCountsVisitors(props.rollups);

  return props.rollups;
}

/**
 * Refuses questions this table cannot answer.
 *
 * At synthesis, where somebody can still read it. The query would otherwise
 * name a column the table has never heard of, and fail once an hour in a
 * bucket nobody is watching.
 *
 * @throws {Error} naming the questions and how to turn their count off.
 */
function assertNothingCountsVisitors(asked: readonly Rollup[]): void {
  const counting = asked.filter((rollup) => rollup.countsVisitors === true);

  if (counting.length === 0) {
    return;
  }

  const named = counting.map((rollup) => rollup.name).join(", ");

  throw new Error(
    `${named} counts visitors, and this table describes no` +
      ` ${visitorAddressField} column to count them from. Either deliver` +
      ` ${visitorAddressField}, which the default field set does, or wrap` +
      ` the question in withoutVisitorCount.`,
  );
}
