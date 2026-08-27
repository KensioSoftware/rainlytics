// The questions people actually ask, and the SQL that answers each one.
//
// Shared rather than kept in the command line, because three halves read
// them. The `rainlytics` command runs them, the CDK registers them as Athena
// named queries so the console shows what the command runs, and M3's
// scheduled rollups will compute the same numbers on a timer.
//
// Nothing here reaches for the AWS SDK or for CDK. It is text.

import { defaultLogDataset, type LogDataset } from "./dataset.js";
import type { TimeRange } from "./time-range.js";

/**
 * What marks a request as automated.
 *
 * Four substrings, matched without regard to case against the user agent
 * CloudFront logged. Bots are most of a quiet site's traffic, so an
 * unfiltered pageview count is misleading rather than raw. One hour of the
 * reference site in August 2026 held 9,492 requests, of which 3,748 matched
 * this and 1,951 were a single crawler.
 *
 * Substrings rather than whole words, because a crawler names itself
 * `ClaudeBot/1.0` and `PerplexityBot/1.0` with the token glued to a word.
 * The cost of that is a device whose name happens to contain one, and the
 * Cubot range of Android phones is the example. Anyone who cares can count
 * both ways with `--include-bots` and see how much of the difference is
 * theirs.
 *
 * Lowercase, and matched against a lowercased user agent. Trino reads an
 * inline `(?i)` and would take the flag on the pattern, but folding the case
 * of both sides says the same thing in a form every engine reads the same
 * way.
 */
export const botUserAgentPattern = "bot|crawl|spider|slurp";

/**
 * The span a saved copy of a rollup covers.
 *
 * A named query registered in the console cannot carry the dates a command
 * computed, since those would be the dates of whoever deployed it. This
 * stands for "whatever month it is when you run this", which Athena works out
 * for itself and prunes on.
 */
export const currentMonth = "the current month";

/** How far back a rollup looks, or the standing range a saved copy uses. */
export type RollupRange = TimeRange | typeof currentMonth;

/** What a rollup needs telling before its SQL can be written. */
export interface RollupRequest {
  /** The span the question covers. */
  readonly range: RollupRange;

  /** Whether automated traffic is counted. */
  readonly includeBots: boolean;

  /** How many rows a ranked rollup answers with. */
  readonly limit: number;

  /**
   * The query-string parameter a rollup reading one takes its values from.
   *
   * Ignored by the rollups that read whole columns, the way `limit` is
   * ignored by the one answering a single row.
   */
  readonly param: string;

  /**
   * The sections of the site counted, as paths a counted request starts with.
   * A request counts when it starts with any of them, and an empty list
   * counts the whole distribution.
   *
   * A set because a section of a site is not always one prefix. Search boxes
   * at `/words/search/` and `/sentences/search/` have no value covering both,
   * and counting them one at a time leaves the addition to whoever reads the
   * two answers.
   *
   * Matched against the decoded path, so they name the address a reader sees
   * rather than the escapes the record holds.
   */
  readonly paths?: readonly string[] | undefined;

  /**
   * The site counted, where one distribution serves several. Absent counts
   * every host delivering into the table.
   */
  readonly host?: string | undefined;

  /** Where the table is, which is one definition for every reader. */
  readonly dataset: LogDataset;
}

/**
 * One question, and the SQL that answers it.
 *
 * The ones Rainlytics ships are in `rollup-questions.ts`, and a site can
 * write its own. A rollup writes what it selects and groups by, and calls
 * {@link rowsFor} for the rows underneath. That is where the partition
 * predicate, the bot filter and the host and paths a caller narrowed to are
 * written, and a question filtering its own way would answer a different
 * question from its neighbours without saying so.
 *
 * ```typescript
 * const countries: Rollup = {
 *   name: "countries",
 *   summary: "Count views by country.",
 *   description: "Counts where readers were, most read from first.",
 *   isRanked: true,
 *   body: (request) =>
 *     [
 *       "SELECT c_country AS country, count(*) AS views",
 *       `  FROM ${qualifiedTableName(request.dataset)}`,
 *       rowsFor(request, ["sc_content_type LIKE 'text/html%'"]),
 *       "  GROUP BY 1",
 *       "  ORDER BY 2 DESC, 1",
 *       `  LIMIT ${String(request.limit)}`,
 *     ].join("\n"),
 * };
 * ```
 *
 * `rollupSql(countries, rollupRequest({ range }))` is then the SQL to run,
 * and the `RollupQueries` construct saves it in the Athena console beside the
 * built-in ones.
 */
export interface Rollup {
  /**
   * What it is called, as in `rainlytics pageviews`.
   *
   * Lowercase words joined by hyphens. It names a subcommand, and a saved
   * copy of the query in the Athena console takes it too. It has to survive
   * both.
   */
  readonly name: string;

  /** One line, for the command list. */
  readonly summary: string;

  /** What it counts and what it leaves out, for its own help. */
  readonly description: string;

  /** Whether it answers with a ranked list, and so takes a row limit. */
  readonly isRanked: boolean;

  /**
   * Whether it reads one query-string parameter, and so takes `--param`.
   *
   * Absent on the rollups that read whole columns. Only a question about
   * what somebody typed has a parameter to be told about.
   */
  readonly namesAParameter?: boolean | undefined;

  /** What it selects and groups by, given the filters below it. */
  readonly body: (request: RollupRequest) => string;
}

/**
 * A request with whatever it left out filled in.
 *
 * The dataset in particular. A rollup that wrote the table name out would be
 * a second definition of it, and the one that drifts is always the one
 * nothing deploys.
 */
export function rollupRequest(
  over: Partial<RollupRequest> & Pick<RollupRequest, "range">,
): RollupRequest {
  return {
    includeBots: false,
    limit: 20,
    param: "q",
    dataset: defaultLogDataset,
    ...over,
  };
}

/** The SQL one rollup runs for one request. */
export function rollupSql(rollup: Rollup, request: RollupRequest): string {
  return `${rollup.body(request).trimEnd()}\n`;
}

/**
 * The names a rollup can take.
 *
 * Lowercase words joined by hyphens. A subcommand and a CDK logical id both
 * read that, and neither reads anything else. `status-codes` passes.
 * `Status Codes` deploys under a name CDK has to mangle, and reads as a
 * subcommand nobody can type.
 *
 * @throws {Error} for a name outside that set.
 */
export function assertRollupName(name: string): void {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/u.test(name)) {
    throw new Error(
      `The rollup name "${name}" is not one a subcommand can carry. Use` +
        ` lowercase words joined by hyphens, as in "cache-hit-ratio".`,
    );
  }
}

export { quoted, rowsFor } from "./rollup-rows.js";
