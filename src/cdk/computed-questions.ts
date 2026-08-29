// Which questions a deployment computes, given what its table carries.
//
// Apart from `summary-configuration.ts` because it answers one question that
// nothing else in the settling has to think about. Every other choice a
// deployment makes is between what it was told and a default. This one is
// between what it was told and what the delivered field set can support.

import {
  countsVisitorsFrom,
  missingVisitorCountFields,
} from "../log-fields.js";
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

  assertNothingCountsVisitors(props.rollups, props.table.fields);

  return props.rollups;
}

/**
 * Refuses questions this table cannot answer.
 *
 * At synthesis, where somebody can still read it. The query would otherwise
 * name a column the table has never heard of, and fail once an hour in a
 * bucket nobody is watching.
 *
 * The message names the fields actually absent. A delivery keeping the
 * address and dropping the user agent counts nobody, and being told to add
 * the address would send its author looking at a field already there.
 *
 * @throws {Error} naming the questions, what is missing, and how to turn
 *   their count off.
 */
function assertNothingCountsVisitors(
  asked: readonly Rollup[],
  fields: readonly string[],
): void {
  const counting = asked.filter((rollup) => rollup.countsVisitors === true);

  if (counting.length === 0) {
    return;
  }

  const named = counting.map((rollup) => rollup.name).join(", ");
  const missing = missingVisitorCountFields(fields).join(" and ");

  throw new Error(
    `${named} counts visitors, and this deployment's delivery leaves out` +
      ` ${missing}. A visitor is a hash of the viewer's address and their` +
      ` user agent, and both have to be delivered for one to be counted.` +
      ` Either add ${missing} to the delivered field set, or wrap the` +
      ` question in withoutVisitorCount.`,
  );
}
