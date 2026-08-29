// The questions people actually ask, and the SQL that answers each one.
//
// Shared rather than kept in the command line, because three halves read
// them. The `rainlytics` command runs them, the CDK registers them as Athena
// named queries so the console shows what the command runs, and M3's
// scheduled rollups will compute the same numbers on a timer.
//
// Nothing here reaches for the AWS SDK or for CDK. It is text.

import { defaultLogDataset, type LogDataset } from "./dataset.js";
import type { SummaryCell } from "./rollup-summaries.js";
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

/**
 * The statuses a search rollup counts as a redirect by default.
 *
 * 302, 303 and 307. Those are what a site answers when it sends a reader to
 * the thing they searched for.
 *
 * 301 and 308 are left out. A permanent redirect is address tidying, and a
 * reader gets one whatever they typed. A site answering `/search?q=happy`
 * with a 308 to `/search/?q=happy` carries the term on the redirect and
 * again on the request behind it, and counting the 308 reports one reader as
 * two searches and calls the first of them a term the site publishes a page
 * for. A canonical-host 301 does it again.
 *
 * A site whose exact match answers 301 says so with `--redirect-status`.
 */
export const defaultRedirectStatuses: readonly string[] = ["302", "303", "307"];

/**
 * The window a scheduled summary is being computed for.
 *
 * A second standing range, alongside {@link currentMonth}, and it stands for
 * something the query text cannot know. `RollupSummaries` writes one query per
 * question at deploy time and the job runs it once an hour, against a
 * different window each time. Under this range the partition predicate comes
 * out as `windowPlaceholder`, and `windowedSql` in `summary-runs.ts` puts the
 * window in on the way to Athena.
 *
 * The rest of the query is written by the builder every other reader uses. A
 * scheduled job and a `rainlytics` command asking the same question over the
 * same span therefore send the same SQL.
 */
export const summarisedWindow = "the window being summarised";

/** How far back a rollup looks, or the standing range a saved copy uses. */
export type RollupRange =
  | TimeRange
  | typeof currentMonth
  | typeof summarisedWindow;

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
   * The statuses counted as a search sent to what it asked for.
   *
   * {@link defaultRedirectStatuses} where nobody says, and that comment
   * carries the reasoning. A site knows what its own search page answers
   * with, and one whose exact match is a 301 reads a column that is right
   * for it.
   *
   * Ignored by the rollups counting every response as it came, the way
   * `param` is ignored by the ones reading whole columns. An empty list
   * counts no search as redirected.
   */
  readonly redirectStatuses: readonly string[];

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
 * How one question's answer is put together from several stored windows.
 *
 * A reader asking about the last seven days is asking about 29 summaries, and
 * the arithmetic between them belongs to the question. Two windows' counts of
 * one path add up. Two windows' cache hit percentages average to a figure
 * about nothing, and the percentage has to be worked out again once the counts
 * underneath it have been added.
 *
 * A rollup that leaves this out answers from one stored window and says so
 * over anything longer. That is the safe default for a question this package
 * has never seen, and `docs/summaries/` has what a wrong guess would produce.
 *
 * Two truths hold whatever a rollup declares here. A ranked answer assembled
 * from several windows is approximate, because a path outside the top rows of
 * every window is missing from all of them. And a visitor count belongs to one
 * day, for the reason `VisitorCount` sets out at length.
 */
export interface RollupTotals {
  /**
   * The columns holding counts, which add across windows.
   *
   * Every other column names a row. `pageviews` adds `views` and matches its
   * rows on `path`, and `searches` adds `searches` and `redirected` and
   * matches on the term and the section it was typed into.
   *
   * The first of them is what a ranked answer is ordered by, matching the
   * `ORDER BY 2 DESC` a rollup writes for one window.
   */
  readonly added: readonly string[];

  /**
   * The columns worked out again once the counts have been added, by name.
   *
   * A ratio, a percentage or an average is derived from the counts beside it
   * and has no meaning added or averaged. Each function is handed the added
   * counts of one row and answers with the cell to write.
   */
  readonly recomputed?:
    | Readonly<
        Record<string, (added: Readonly<Record<string, number>>) => SummaryCell>
      >
    | undefined;
}

/**
 * One question, and the SQL that answers it.
 *
 * The five the command line answers are in `rollup-questions.ts`,
 * `beacon-rollup.ts` holds the one a site running the beacon opts into, and a
 * site can write its own. A rollup writes what it selects and groups by, and calls
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

  /**
   * Whether it counts redirects, and so takes `--redirect-status`.
   *
   * Absent on the rollups counting every response as it came. Only a
   * question separating a search sent to its answer from one that produced a
   * list has redirect statuses to be told about.
   */
  readonly countsRedirects?: boolean | undefined;

  /**
   * How its rows add up across stored summaries, where they do.
   *
   * Absent on a question whose answer belongs to one window. A command asked
   * about a longer span then reports which windows it found and offers the
   * query that would cover them.
   */
  readonly totals?: RollupTotals | undefined;

  /**
   * Whether its SQL tells one viewer from another.
   *
   * Set on `beacon-events`, which bounds a flood by capping what one visitor
   * contributes, and absent everywhere else. It names the same two delivered
   * fields a visitor count is hashed from, so a deployment carrying no viewer
   * address cannot answer the question at all. `RollupSummaries` refuses one
   * at synthesis rather than letting the query fail once an hour.
   *
   * Different from {@link countsVisitors}, which decides whether a summary
   * carries a `visitors` field beside the rows. This one is about the rows.
   */
  readonly identifiesViewers?: boolean | undefined;

  /**
   * Whether a summary of it carries how many visitors the window saw.
   *
   * Set on `pageviews` and absent everywhere else. The count is over the
   * pages a request's narrowing covers, whatever the question beside it is
   * counting, so a summary of status codes carrying one would report a number
   * about rows it never looked at. `visitor-counts.ts` has what a visitor is
   * and `docs/visitors/` has what the number means.
   *
   * It costs a second Athena query per window per run. The five shipped
   * questions on both cadences, recomputing two windows, come to 250 queries
   * a day and about 38 cents a month. Turning this on for one of them adds
   * 50 queries, which is about 8 cents.
   */
  readonly countsVisitors?: boolean | undefined;

  /** What it selects and groups by, given the filters below it. */
  readonly body: (request: RollupRequest) => string;
}

/**
 * One question with its visitor count off.
 *
 * A deployment over a table carrying no viewer address computes no visitor
 * count, and `RollupSummaries` derives that for the questions Rainlytics
 * ships. A site naming its questions instead says so through this.
 *
 * ```typescript
 * new RollupSummaries(this, "RainlyticsSummaries", {
 *   table,
 *   workgroup,
 *   rollups: [withoutVisitorCount(pageviews), referrers],
 * });
 * ```
 */
export function withoutVisitorCount(rollup: Rollup): Rollup {
  const { countsVisitors: _countsVisitors, ...rest } = rollup;

  return rest;
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
    redirectStatuses: defaultRedirectStatuses,
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

export {
  matchedPath,
  partitionPredicate,
  rowsFor,
  windowPlaceholder,
} from "./rollup-rows.js";
export { quoted } from "./sql-text.js";
