// Which rows a rollup reads, as a `WHERE` clause.
//
// One builder for every question, because every one of them leaves out the
// same automated traffic over the same partitions. A rollup that filtered
// differently would answer a different question from its neighbours without
// saying so.
//
// The same argument reaches past the ones shipped here. A site with a
// question of its own wants the partition predicate and the bot filter
// written the way Rainlytics writes them, and a hand-written copy is a second
// statement of both rules. `rowsFor` is exported from the package root for
// that.

import { decodedColumn } from "./log-encoding.js";
import { botUserAgentPattern, currentMonth } from "./rollups.js";
import type { RollupRequest } from "./rollups.js";
import { quoted } from "./sql-text.js";
import { partitionValuesCovering } from "./time-range.js";

/**
 * The rows a request reads, as a `WHERE` clause.
 *
 * The partition predicate comes first and is the only part that changes what
 * is read. Everything after it narrows rows that have already been paid for.
 *
 * `extra` holds whatever else one question needs, joined on after the
 * partitions, the bot filter and the host and path a caller narrowed to. The
 * pageview rollup passes the three conditions that separate a page from the
 * assets beside it in the log.
 *
 * ```typescript
 * `SELECT count(*) FROM ${qualifiedTableName(request.dataset)}\n` +
 *   rowsFor(request, ["cs_uri_query <> '-'"]);
 * ```
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
    ...narrowedTo(request),
    ...extra,
  ];
}

/**
 * The host and the section a request was narrowed to, where it named either.
 *
 * Both sit here with the bot filter rather than beside a question, because
 * every rollup takes them and one that narrowed differently would answer a
 * different question from its neighbours without saying so.
 *
 * Neither changes what a query reads. The partition predicate has already
 * decided that, and these narrow rows that are paid for either way.
 *
 * The path is a prefix, written with `strpos` rather than `LIKE`. A path
 * carrying `_` is ordinary and `LIKE` reads it as a wildcard, so matching
 * that way would need an `ESCAPE` clause and every metacharacter in the
 * caller's text escaped before it went in. `strpos(haystack, needle) = 1`
 * takes the text literally and has nothing to escape.
 */
function narrowedTo(request: RollupRequest): readonly string[] {
  return [
    ...(request.host === undefined
      ? []
      : [`x_host_header = ${quoted(request.host)}`]),
    ...(request.path === undefined
      ? []
      : [
          `strpos(${decodedColumn("cs_uri_stem")}, ${quoted(request.path)}) = 1`,
        ]),
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
