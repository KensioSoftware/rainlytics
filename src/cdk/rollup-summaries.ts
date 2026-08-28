import { Construct } from "constructs";

import type { RollupSummariesProps } from "./summary-configuration.js";
import { summaryConfiguration } from "./summary-configuration.js";
import type { SummariesBucket } from "./summary-bucket.js";
import { summariesBucket } from "./summary-bucket.js";
import { SummaryFunction } from "./summary-function.js";
import { summaryRuns } from "./summary-questions.js";
import { SummarySchedules } from "./summary-schedules.js";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import type { CfnSchedule } from "aws-cdk-lib/aws-scheduler";

/**
 * The named questions, computed on a schedule and written to S3 as summaries.
 *
 * ```typescript
 * new RollupSummaries(this, "RainlyticsSummaries", { table, workgroup });
 * ```
 *
 * Every question gets a schedule per cadence. A schedule fires, a Lambda
 * function starts the query Athena was given at deploy time, waits for it,
 * and puts the rows in the bucket under the key `summaryKey` builds. Reading
 * that answer afterwards costs a GET however many people ask.
 *
 * Nothing here is always-on and nothing carries a per-hour floor. Scheduler
 * bills per invocation, Lambda per millisecond, Athena per byte scanned and
 * S3 per request and per byte. A site with no traffic still runs the queries
 * and pays Athena's ten million byte minimum for each, which is a few cents a
 * month for the five shipped questions on both cadences.
 *
 * The SQL is built at synthesis by the builder the `rainlytics` command uses,
 * with the window left as a placeholder the job fills in when it runs. So the
 * query is legible in the CloudFormation template and in the schedule's
 * target input, and a scheduled summary and a `rainlytics pageviews --last 1h`
 * run over the same hour count it the same way.
 *
 * A run computes {@link RollupSummariesProps.recomputedWindows} windows and
 * not only the one that has just closed. A record CloudFront delivers after
 * its window was computed is invisible until something computes that window
 * again, and a job that only ever wrote the newest window never would.
 *
 * A query that fails takes its run with it. There is nothing watching, so the
 * failure lands on the function's error metric and in its log group, and the
 * summaries for that question stop appearing. An alarm over either is the one
 * piece of this that would carry a fixed monthly charge, so it is left to a
 * site to add if it wants one. `docs/summary-schedule/` has what to look at.
 */
export class RollupSummaries extends Construct {
  /** Where the summaries are written. */
  readonly bucket: SummariesBucket;

  /** The function the schedules invoke. */
  readonly lambda: IFunction;

  /** The schedules, grouped by cadence and then by question. */
  readonly schedules: readonly CfnSchedule[];

  constructor(scope: Construct, id: string, props: RollupSummariesProps) {
    super(scope, id);

    const settled = summaryConfiguration(props);

    this.bucket = summariesBucket(this, props);
    this.lambda = new SummaryFunction(this, "Job", {
      table: props.table,
      workgroup: props.workgroup,
      bucket: this.bucket,
      windows: settled.windows,
      ...(props.timeout === undefined ? {} : { timeout: props.timeout }),
      ...(props.logRetention === undefined
        ? {}
        : { logRetention: props.logRetention }),
    }).lambda;

    this.schedules = new SummarySchedules(this, "Schedules", {
      lambda: this.lambda,
      lag: settled.lag,
      namePrefix: settled.namePrefix,
      runs: summaryRuns({
        rollups: settled.rollups,
        granularities: settled.granularities,
        dataset: props.table.dataset,
        ...(props.requests === undefined ? {} : { requests: props.requests }),
      }),
    }).schedules;
  }
}
