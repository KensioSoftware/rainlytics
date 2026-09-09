// What a deployment's saved queries were told, checked and settled.
//
// Apart from the construct for the reason `summary-configuration.ts` is
// apart from `RollupSummaries`. This decides which questions get saved and
// what each copy covers, and the construct writes the named queries that
// answer them.

import { rollups } from "../rollup-questions.js";
import type { Rollup, RollupRequest } from "../rollups.js";
import type { LogTable } from "./log-table.js";
import type { QueryWorkgroup } from "./query-workgroup.js";

/**
 * What one saved query is narrowed to.
 *
 * A rollup request without the two parts the construct settles for itself.
 * The range is always the current month, and the dataset comes from the
 * table. Everything a rollup command can be told is here, and a field added
 * to {@link RollupRequest} arrives here with no edit.
 */
export type SavedRollupRequest = Partial<
  Omit<RollupRequest, "range" | "dataset">
>;

/**
 * What saved queries read off a deployment's scheduled summaries.
 *
 * `RollupSummaries` publishes all four, so a deployment passes the construct
 * itself. Structural for the reason `LogDeliveryBucket` is, and so that
 * nothing here has to import the construct it reads.
 */
export interface SummarisedRollups {
  /** The table the questions read. */
  readonly table: LogTable;

  /** The workgroup they run in. */
  readonly workgroup: QueryWorkgroup;

  /** The questions computed, as the summaries settled them. */
  readonly rollups: readonly Rollup[];

  /** What each question covers. */
  readonly requests?: Readonly<Record<string, SavedRollupRequest>> | undefined;
}

/**
 * Saved copies of whatever a deployment's schedules compute.
 *
 * The one list, read off the summaries rather than written out a second time.
 * A deployment that adds a question to `RollupSummaries` alone would
 * otherwise get a schedule for it and a console holding the shipped six, and
 * the deploy would report success.
 *
 * ```typescript
 * const summaries = new RollupSummaries(this, "RainlyticsSummaries", {
 *   table,
 *   workgroup,
 *   rollups: [...rollups, countries],
 * });
 *
 * new RollupQueries(this, "RainlyticsRollups", { summaries });
 * ```
 *
 * The questions saved are the ones the summaries settled on, so a deployment
 * over a table carrying no viewer address saves the six with the visitor
 * count off, which is what its schedules run.
 */
export interface RollupQueriesFromSummaries {
  /** The scheduled summaries whose questions and narrowing these copy. */
  readonly summaries: SummarisedRollups;

  /** Not here. The summaries carry the table. */
  readonly table?: undefined;

  /** Not here. The summaries carry the workgroup. */
  readonly workgroup?: undefined;

  /** Not here. The summaries carry the list. */
  readonly rollups?: undefined;

  /** Not here. The summaries carry the narrowing. */
  readonly requests?: undefined;
}

/** Saved copies over a table, told their own list. */
export interface RollupQueriesOverTable {
  /** Not here. A table and a list are given instead. */
  readonly summaries?: undefined;

  /** The table they read, which is where their names come from. */
  readonly table: LogTable;

  /** The workgroup they are saved in and would run under. */
  readonly workgroup: QueryWorkgroup;

  /**
   * The questions to save, which default to the ones Rainlytics ships.
   *
   * A site with a rollup of its own passes `[...rollups, countries]` to save
   * that beside them. Passing a list of its own alone saves that alone.
   *
   * A site whose own version of a shipped question answers differently
   * leaves the shipped one out:
   *
   * ```typescript
   * rollups: [
   *   ...rollups.filter((rollup) => rollup.name !== "searches"),
   *   mySearches,
   * ],
   * ```
   *
   * Two rollups of one name are refused at synthesis, since one saved query
   * cannot answer both.
   */
  readonly rollups?: readonly Rollup[] | undefined;

  /**
   * What each saved query covers, by the name of its rollup.
   *
   * Per rollup and not one set across all of them. `/search/` is the search
   * page to `searches` and one directory of a site to `pageviews`. A shared
   * set would save `rainlytics-pageviews` as a query counting the search page
   * under a name promising the whole site. That is the same fault the other
   * way round. A shared set would also carry `param`, which reaches the one
   * rollup that reads a parameter.
   *
   * A rollup named here takes what it is given. One left out takes the
   * defaults `rollupRequest` fills in, which a command starts from too.
   *
   * A fact that does belong to every question, such as the host of one site
   * on a distribution serving several, is a variable spread into each entry.
   *
   * ```typescript
   * const site = { host: "docs.example.com" };
   *
   * new RollupQueries(this, "RainlyticsRollups", {
   *   table,
   *   workgroup,
   *   requests: {
   *     pageviews: site,
   *     searches: { ...site, paths: ["/search/"], param: "term" },
   *   },
   * });
   * ```
   */
  readonly requests?: Readonly<Record<string, SavedRollupRequest>> | undefined;
}

/**
 * What the saved copies of the rollups need telling.
 *
 * Either a deployment's scheduled summaries, which carry all four, or a table
 * and a workgroup with a list of questions beside them. Naming both is
 * refused, since the whole point of the first shape is that there is one list.
 */
export type RollupQueriesProps =
  | RollupQueriesFromSummaries
  | RollupQueriesOverTable;

/** The four values the queries are saved from, whichever shape they arrived in. */
export function savedFrom(props: RollupQueriesProps): SummarisedRollups {
  if (props.summaries === undefined) {
    return {
      table: props.table,
      workgroup: props.workgroup,
      rollups: props.rollups ?? rollups,
      ...(props.requests === undefined ? {} : { requests: props.requests }),
    };
  }

  assertOneList(props);

  return props.summaries;
}

/**
 * Refuses a deployment that gave both a set of summaries and a list of its own.
 *
 * The type refuses it already. This is for a caller reaching past the type,
 * and for the JavaScript one that has no type to reach past. Taking the
 * summaries and ignoring the rest would save queries for questions the
 * deployment's code says it wanted, and report success.
 *
 * @throws {Error} naming what was given twice.
 */
function assertOneList(props: RollupQueriesFromSummaries): void {
  // Typed as unknown because the type above says all four are absent, and
  // this exists for the caller that got past the type.
  const named: readonly (readonly [string, unknown])[] = [
    ["table", props.table],
    ["workgroup", props.workgroup],
    ["rollups", props.rollups],
    ["requests", props.requests],
  ];
  const alsoGiven = named
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
    .join(", ");

  if (alsoGiven === "") {
    return;
  }

  throw new Error(
    `RollupQueries was given summaries and ${alsoGiven}, and it cannot save` +
      ` two lists under one set of names. Summaries carry the table, the` +
      ` workgroup, the questions and their narrowing, so pass those alone.`,
  );
}
