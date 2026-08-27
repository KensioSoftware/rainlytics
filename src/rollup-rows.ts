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
//
// `matchedPath` goes out beside it and names which of the paths a row began
// with. It reads the prefix tests the filter writes, so the column and the
// filter under it hold one definition of a prefix match between them.

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
 * partitions, the bot filter and the host and paths a caller narrowed to. The
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

/**
 * Which of the paths a request narrowed to a row began with, as an expression.
 *
 * A rollup given several paths counts them together, and a row carrying a term
 * and a count says nothing about which of them produced it. Two search boxes
 * give two answers to the same word. Select this beside the count and each row
 * names the box it came from:
 *
 * ```typescript
 * `SELECT ${decodedParameter(request.param)} AS term,\n` +
 *   `  ${matchedPath(request)} AS section, count(*) AS searches`;
 * ```
 *
 * ```text
 * term    section             searches
 * ------  ------------------  --------
 * happy   /words/search/            41
 * happy   /sentences/search/        12
 * ```
 *
 * It is a `CASE` over the prefix tests {@link rowsFor} filters with, branch by
 * branch in the order the request gave them. Where two of the paths overlap
 * the first one given wins. `/guides/` alongside `/guides/advanced/` reports a
 * row under the second as `/guides/`, and every row is in exactly one of them.
 *
 * One path is that path, written as a literal. Every row counted began with it,
 * and a `CASE` there asks a question with one answer. A rollup selects this
 * however many paths it was given and gets a column true of every row either
 * way.
 *
 * No paths at all is `NULL`, cast so the column still comes back as text. The
 * whole distribution was counted and no prefix matched. An empty string would
 * claim a prefix nobody asked for, and Athena types an uncast `NULL` as
 * unknown.
 */
export function matchedPath(request: RollupRequest): string {
  const paths = request.paths ?? [];
  const [first] = paths;

  if (first === undefined) {
    return "CAST(NULL AS varchar)";
  }

  if (paths.length === 1) {
    return quoted(first);
  }

  const branches = paths.map(
    (path) => `WHEN ${startingWith(path)} THEN ${quoted(path)}`,
  );

  return `CASE ${branches.join(" ")} END`;
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
 * The host and the sections a request was narrowed to, where it named either.
 *
 * Both sit here with the bot filter rather than beside a question, because
 * every rollup takes them and one that narrowed differently would answer a
 * different question from its neighbours without saying so.
 *
 * Neither changes what a query reads. The partition predicate has already
 * decided that, and these narrow rows that are paid for either way.
 */
function narrowedTo(request: RollupRequest): readonly string[] {
  return [
    ...(request.host === undefined
      ? []
      : [`x_host_header = ${quoted(request.host)}`]),
    ...startingWithAny(request.paths ?? []),
  ];
}

/**
 * A row starting with any one of the paths, where the request named some.
 *
 * Each path is a prefix, written with `strpos` rather than `LIKE`. A path
 * carrying `_` is ordinary and `LIKE` reads it as a wildcard, so matching
 * that way would need an `ESCAPE` clause and every metacharacter in the
 * caller's text escaped before it went in. `strpos(haystack, needle) = 1`
 * takes the text literally and has nothing to escape.
 *
 * Several paths are that same test once each, joined by `OR`. A set of them
 * keeps every property one path has. The bracket around them keeps the `AND`
 * above from swallowing the first branch. A single path is written without
 * one, and naming one section writes what it always wrote.
 */
function startingWithAny(paths: readonly string[]): readonly string[] {
  if (paths.length === 0) {
    return [];
  }

  const anyOf = paths.map((path) => startingWith(path)).join(" OR ");

  return [paths.length === 1 ? anyOf : `(${anyOf})`];
}

/** A row whose decoded path begins with one prefix. */
function startingWith(path: string): string {
  return `strpos(${decodedColumn("cs_uri_stem")}, ${quoted(path)}) = 1`;
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
