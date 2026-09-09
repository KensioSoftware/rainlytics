import { CfnNamedQuery } from "aws-cdk-lib/aws-athena";
import { Construct } from "constructs";

import { type LogDataset, savedQueryPrefix } from "../dataset.js";
import type { Rollup } from "../rollups.js";
import {
  assertRollupName,
  currentMonth,
  rollupRequest,
  rollupSql,
} from "../rollups.js";
import { assertAthenaLength, describing } from "./named-query-text.js";
import type {
  RollupQueriesProps,
  SummarisedRollups,
} from "./saved-query-configuration.js";
import { savedFrom } from "./saved-query-configuration.js";
import {
  assertOneQueryEach,
  assertRequestedNames,
  queryId,
} from "./saved-query-names.js";

/**
 * The rollup SQL, saved in Athena so the console shows what the command runs.
 *
 * ```typescript
 * new RollupQueries(this, "RainlyticsRollups", { summaries });
 * ```
 *
 * Reading the summaries is what keeps a deployment to one list. The questions
 * saved are the ones its schedules compute, so a question added to
 * `RollupSummaries` shows up in the console without being named twice.
 * A deployment with no summaries passes a table and a workgroup instead:
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
 * {@link RollupQueriesOverTable.requests}. `searches` is why. It reads one
 * query-string parameter on one page, and a copy left to the defaults counts
 * every query string on the distribution while its description tells the
 * reader to name the search page. Each saved description says what its own
 * copy covers.
 *
 * A site writing a rollup of its own passes it to the summaries, and these
 * follow:
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
 * Every saved query is named `rainlytics-<name>`. Athena lists named queries
 * flat within a workgroup, and the prefix is what gathers a deployment's own
 * into one place among whatever else somebody has saved there.
 */
export class RollupQueries extends Construct {
  /** The saved queries, in the order the rollups are declared. */
  readonly queries: readonly CfnNamedQuery[];

  constructor(scope: Construct, id: string, props: RollupQueriesProps) {
    super(scope, id);

    const saved = savedFrom(props);

    assertOneQueryEach(saved.rollups);
    assertRequestedNames(saved.rollups, Object.keys(saved.requests ?? {}));

    this.queries = saved.rollups.map((rollup) => this.save(rollup, saved));
  }

  private save(rollup: Rollup, saved: SummarisedRollups): CfnNamedQuery {
    const dataset: LogDataset = saved.table.dataset;

    assertRollupName(rollup.name);

    // The range and the dataset come last. A caller reaching past the type
    // then cannot bake a date into the template or point a saved query at a
    // table this deployment never created.
    const request = rollupRequest({
      ...saved.requests?.[rollup.name],
      range: currentMonth,
      dataset,
    });

    const name = `${savedQueryPrefix}${rollup.name}`;
    const description = describing(rollup, request);

    assertAthenaLength("name", name);
    assertAthenaLength("description", description);

    const query = new CfnNamedQuery(this, queryId(rollup.name), {
      name,
      database: dataset.databaseName,
      workGroup: saved.workgroup.workgroupName,
      description,
      queryString: rollupSql(rollup, request),
    });

    // A named query names its workgroup and its database as strings, so
    // nothing in the template says either has to exist first.
    query.addResourceDependency(saved.workgroup.workgroup);
    query.addResourceDependency(saved.table.table);

    return query;
  }
}
