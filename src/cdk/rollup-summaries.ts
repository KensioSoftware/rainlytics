import type { IGrantable } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import type { Rollup } from "../rollups.js";
import type { LogTable } from "./log-table.js";
import type { QueryWorkgroup } from "./query-workgroup.js";
import type { SavedRollupRequest } from "./saved-query-configuration.js";
import type { RollupSummariesProps } from "./summary-configuration.js";
import { summaryConfiguration } from "./summary-configuration.js";
import type { SummariesBucket } from "./summary-bucket.js";
import { summariesBucket } from "./summary-bucket.js";
import { summaryReadStatements } from "./summary-permissions.js";
import type { ReportNotifications } from "./report-notifications.js";
import { summaryJobs } from "./summary-jobs.js";
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
 * month for the six default questions on both cadences.
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
  /** The table the questions read. */
  readonly table: LogTable;

  /** The workgroup they run in. */
  readonly workgroup: QueryWorkgroup;

  /**
   * The questions this deployment computes, as it settled them.
   *
   * What the deployment was told, or the six shipped questions where it was
   * told nothing, with the visitor count taken off where the table carries no
   * viewer address. `RollupQueries` reads this so that the console holds the
   * queries the schedules run, rather than a second list that agreed with
   * this one on the day it was written.
   */
  readonly rollups: readonly Rollup[];

  /** What each question covers, as the deployment was told. */
  readonly requests?: Readonly<Record<string, SavedRollupRequest>> | undefined;

  /** Where the summaries are written. */
  readonly bucket: SummariesBucket;

  /** The function the schedules invoke. */
  readonly lambda: IFunction;

  /** The function that assembles calendar reports. */
  readonly reportLambda: IFunction;

  /** The schedules, grouped by cadence and then by question. */
  readonly schedules: readonly CfnSchedule[];

  /** The daily schedule that writes closed calendar reports. */
  readonly reportSchedule: CfnSchedule;

  /** The topic, publisher function and dead-letter queue, when configured. */
  readonly reportNotifications?: ReportNotifications | undefined;

  constructor(scope: Construct, id: string, props: RollupSummariesProps) {
    super(scope, id);

    const settled = summaryConfiguration(props);

    this.table = props.table;
    this.workgroup = props.workgroup;
    this.rollups = settled.rollups;
    this.requests = props.requests;
    this.bucket = summariesBucket(this, props);

    const jobs = summaryJobs(this, props, settled, this.bucket);

    this.lambda = jobs.lambda;
    this.reportLambda = jobs.reportLambda;
    this.schedules = jobs.schedules;
    this.reportSchedule = jobs.reportSchedule;
    this.reportNotifications = jobs.reportNotifications;
  }

  /**
   * Lets an identity read the summaries this deployment writes.
   *
   * ```typescript
   * summaries.grantReadingSummaries(role);
   * ```
   *
   * One `s3:GetObject` on the bucket's objects, which is the whole of what
   * `rainlytics pageviews --last 7d` and its five siblings send. A reader
   * builds the key it wants out of the question and the window, so nothing
   * lists the bucket.
   *
   * `ReadOnlyAccess` already allows that read, so an identity holding it
   * needs no grant here. This is for one built narrower than that, and for
   * a bucket under a customer key, whose `kms:Decrypt` is handed out here as
   * well.
   */
  grantReadingSummaries(grantee: IGrantable): void {
    for (const statement of summaryReadStatements(this.bucket, grantee)) {
      grantee.grantPrincipal.addToPrincipalPolicy(statement);
    }
  }
}
