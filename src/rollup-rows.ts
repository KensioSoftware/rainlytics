// Which rows a rollup reads, as a `WHERE` clause.
//
// One builder for all four questions, because every one of them leaves out
// the same automated traffic over the same partitions. A rollup that filtered
// differently would answer a different question from its neighbours without
// saying so.

import type { LogDataset } from "./dataset.js";
import { botUserAgentPattern, currentMonth } from "./rollups.js";
import type { RollupRequest } from "./rollups.js";
import { partitionValuesCovering } from "./time-range.js";

/**
 * The rows a request reads, as a `WHERE` clause.
 *
 * The partition predicate comes first and is the only part that changes what
 * is read. Everything after it narrows rows that have already been paid for.
 */
export function rowsFor(
  request: RollupRequest,
  extra: readonly string[] = [],
): string {
  return ["  WHERE ", conditions(request, extra).join("\n    AND ")].join("");
}

function conditions(
  request: RollupRequest,
  extra: readonly string[],
): readonly string[] {
  return [
    ...partitionsOf(request),
    ...(request.includeBots
      ? []
      : [
          `NOT regexp_like(lower(cs_user_agent),` +
            ` ${quoted(botUserAgentPattern)})`,
        ]),
    ...extra,
  ];
}

/**
 * The partitions a request reads, and the exact span inside them.
 *
 * A range asked for by date becomes explicit partition values, which is the
 * only form certain to prune. A range left open becomes the current month,
 * written with Athena's own date functions so that a saved copy of the query
 * goes on working without a date baked into it.
 *
 * The timestamp condition after them is what makes the answer exact. The
 * partition values are a cross product, so a week spanning a month boundary
 * reads days at both ends that fall outside the range, and this is what
 * leaves their rows out of the count.
 */
function partitionsOf(request: RollupRequest): readonly string[] {
  if (request.range === currentMonth) {
    return [
      "year = date_format(current_date, '%Y')",
      "month = date_format(current_date, '%m')",
    ];
  }

  return [
    ...partitionValuesCovering(request.range).map(
      (key) => `${key.name} IN (${key.values.map(quoted).join(", ")})`,
    ),
    `cast(timestamp_ms AS bigint)` +
      ` BETWEEN ${String(request.range.from.getTime())}` +
      ` AND ${String(request.range.to.getTime())}`,
  ];
}

/** One value as SQL writes it, with any quote in it doubled. */
function quoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The table a rollup reads, qualified so a session database cannot change it. */
export function tableIn(dataset: LogDataset): string {
  return `"${dataset.databaseName}"."${dataset.tableName}"`;
}
