import { CfnNamedQuery } from "aws-cdk-lib/aws-athena";
import { Construct } from "constructs";

import type { LogDataset } from "../dataset.js";
import { rollups } from "../rollup-questions.js";
import type { Rollup } from "../rollups.js";
import { currentMonth, rollupRequest, rollupSql } from "../rollups.js";
import type { LogTable } from "./log-table.js";
import type { QueryWorkgroup } from "./query-workgroup.js";

/** What the saved copies of the rollups need telling. */
export interface RollupQueriesProps {
  /** The table they read, which is where their names come from. */
  readonly table: LogTable;

  /** The workgroup they are saved in and would run under. */
  readonly workgroup: QueryWorkgroup;
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
 * asked for, and there is no range to compute here: dates baked in at deploy
 * time would be the dates of whoever last deployed, and would change the
 * template on every deploy. `date_format(current_date, '%Y')` prunes to the
 * month somebody runs it in and needs nothing kept up to date.
 */
export class RollupQueries extends Construct {
  /** The saved queries, in the order the rollups are declared. */
  readonly queries: readonly CfnNamedQuery[];

  constructor(scope: Construct, id: string, props: RollupQueriesProps) {
    super(scope, id);

    this.queries = rollups.map((rollup) => this.save(rollup, props));
  }

  private save(rollup: Rollup, props: RollupQueriesProps): CfnNamedQuery {
    const dataset: LogDataset = props.table.dataset;

    const query = new CfnNamedQuery(this, queryId(rollup.name), {
      name: `rainlytics-${rollup.name}`,
      database: dataset.databaseName,
      workGroup: props.workgroup.workgroupName,
      description:
        `${rollup.summary} What "rainlytics ${rollup.name}" runs, over the` +
        ` current month.`,
      queryString: rollupSql(
        rollup,
        rollupRequest({ range: currentMonth, dataset }),
      ),
    });

    // A named query names its workgroup and its database as strings, so
    // nothing in the template says either has to exist first.
    query.addResourceDependency(props.workgroup.workgroup);
    query.addResourceDependency(props.table.table);

    return query;
  }
}

/** A logical id for one saved query, in the case CDK expects. */
function queryId(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}
