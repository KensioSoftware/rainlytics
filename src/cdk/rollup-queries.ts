import { CfnNamedQuery } from "aws-cdk-lib/aws-athena";
import { Construct } from "constructs";

import type { LogDataset } from "../dataset.js";
import { rollups } from "../rollup-questions.js";
import type { Rollup, RollupRequest } from "../rollups.js";
import {
  assertRollupName,
  currentMonth,
  rollupRequest,
  rollupSql,
} from "../rollups.js";
import { assertAthenaLength, describing } from "./named-query-text.js";
import {
  assertOneQueryEach,
  assertRequestedNames,
  queryId,
} from "./saved-query-names.js";
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

/** What the saved copies of the rollups need telling. */
export interface RollupQueriesProps {
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
 * The rollup SQL, saved in Athena so the console shows what the command runs.
 *
 * ```typescript
 * new RollupQueries(this, "RainlyticsRollups", { table, workgroup });
 * ```
 *
 * One named query per question, written by the same builder the `rainlytics`
 * command writes with. Somebody who wants to know what `rainlytics pageviews`
 * counts can read it in the console, run it, and edit it into a question of
 * their own.
 *
 * The saved copies cover the current month rather than the span a command was
 * given. A command computes explicit partition values for the range it was
 * asked for, and there is no range to compute here. Dates baked in at deploy
 * time would be the dates of whoever last deployed, and would change the
 * template on every deploy. `date_format(current_date, '%Y')` prunes to the
 * month somebody runs it in and needs nothing kept up to date.
 *
 * Everything else a command takes is settled per rollup, through
 * {@link RollupQueriesProps.requests}. `searches` is why. It reads one
 * query-string parameter on one page, and a copy left to the defaults counts
 * every query string on the distribution while its description tells the
 * reader to name the search page. Each saved description says what its own
 * copy covers.
 *
 * A site writing a rollup of its own saves it here too:
 *
 * ```typescript
 * new RollupQueries(this, "RainlyticsRollups", {
 *   table,
 *   workgroup,
 *   rollups: [...rollups, countries],
 * });
 * ```
 *
 * Every saved query is named `rainlytics-<name>`. Athena lists named queries
 * flat within a workgroup, and the prefix is what gathers a deployment's own
 * into one place among whatever else somebody has saved there.
 */
export class RollupQueries extends Construct {
  /** The saved queries, in the order the rollups are declared. */
  readonly queries: readonly CfnNamedQuery[];

  constructor(scope: Construct, id: string, props: RollupQueriesProps) {
    super(scope, id);

    const saving = props.rollups ?? rollups;

    assertOneQueryEach(saving);
    assertRequestedNames(saving, Object.keys(props.requests ?? {}));

    this.queries = saving.map((rollup) => this.save(rollup, props));
  }

  private save(rollup: Rollup, props: RollupQueriesProps): CfnNamedQuery {
    const dataset: LogDataset = props.table.dataset;

    assertRollupName(rollup.name);

    // The range and the dataset come last. A caller reaching past the type
    // then cannot bake a date into the template or point a saved query at a
    // table this deployment never created.
    const request = rollupRequest({
      ...props.requests?.[rollup.name],
      range: currentMonth,
      dataset,
    });

    const name = `rainlytics-${rollup.name}`;
    const description = describing(rollup, request);

    assertAthenaLength("name", name);
    assertAthenaLength("description", description);

    const query = new CfnNamedQuery(this, queryId(rollup.name), {
      name,
      database: dataset.databaseName,
      workGroup: props.workgroup.workgroupName,
      description,
      queryString: rollupSql(rollup, request),
    });

    // A named query names its workgroup and its database as strings, so
    // nothing in the template says either has to exist first.
    query.addResourceDependency(props.workgroup.workgroup);
    query.addResourceDependency(props.table.table);

    return query;
  }
}
