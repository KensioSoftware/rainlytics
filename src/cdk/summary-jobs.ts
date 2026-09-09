// What a summaries deployment runs, being two Lambda functions and the
// schedules that invoke them.
//
// Apart from the construct because it is the verbose part of it and none of
// the verbosity is about what the construct is. Each function takes the same
// table, workgroup and bucket, then a run of optional settings present only
// where the deployment named them. `exactOptionalPropertyTypes` is what makes
// those conditional rather than a property holding `undefined`.
//
// The construct is then what a reader wants it to be: settle the
// configuration, make the bucket, build this, and publish what came back.

import type { IFunction } from "aws-cdk-lib/aws-lambda";
import type { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import type { Construct } from "constructs";

import { ReportFunction } from "./report-function.js";
import { configuredReportNotifications } from "./report-notification-setup.js";
import {
  createReportNotifications,
  type ReportNotifications,
} from "./report-notifications.js";
import { reportQuestions } from "./report-questions.js";
import { ReportSchedule } from "./report-schedule.js";
import type { SummariesBucket } from "./summary-bucket.js";
import type {
  RollupSummariesProps,
  SummaryConfiguration,
} from "./summary-configuration.js";
import { SummaryFunction } from "./summary-function.js";
import { summaryRuns } from "./summary-questions.js";
import { SummarySchedules } from "./summary-schedules.js";

/**
 * One optional setting, written only where the deployment named it.
 *
 * `exactOptionalPropertyTypes` separates a property that is absent from one
 * holding `undefined`, and the constructs below accept the first and refuse
 * the second. Spread this into their props rather than writing the ternary
 * out five times.
 */
function given<K extends string, V>(
  name: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [name]: value } as Record<K, V>);
}

/** What a deployment ends up running. */
export interface SummaryJobs {
  /** The function the summary schedules invoke. */
  readonly lambda: IFunction;

  /** The function that assembles calendar reports. */
  readonly reportLambda: IFunction;

  /** The schedules, grouped by cadence and then by question. */
  readonly schedules: readonly CfnSchedule[];

  /** The daily schedule that writes closed calendar reports. */
  readonly reportSchedule: CfnSchedule;

  /** The topic, publisher function and dead-letter queue, when configured. */
  readonly reportNotifications?: ReportNotifications | undefined;
}

/** Creates all of it, under the settings the deployment settled on. */
export function summaryJobs(
  scope: Construct,
  props: RollupSummariesProps,
  settled: SummaryConfiguration,
  bucket: SummariesBucket,
): SummaryJobs {
  const asking = {
    rollups: settled.rollups,
    granularities: settled.granularities,
    dataset: props.table.dataset,
    ...given("requests", props.requests),
  };
  const questions = reportQuestions(asking);
  const notifications = configuredReportNotifications(
    props.reportNotifications,
    questions.map(({ question }) => question.name),
  );
  const reading = {
    table: props.table,
    workgroup: props.workgroup,
    bucket,
    countsVisitors: settled.countsVisitors,
    ...given("visitorSaltParameter", props.visitorSaltParameter),
    ...given("logRetention", props.logRetention),
  };

  const lambda = new SummaryFunction(scope, "Job", {
    ...reading,
    windows: settled.windows,
    ...given("timeout", props.timeout),
  }).lambda;

  const reportLambda = new ReportFunction(scope, "ReportJob", {
    ...reading,
    ...given("notificationPeriods", notifications?.periods),
    ...given("timeout", props.reportTimeout),
  }).lambda;

  const schedules = new SummarySchedules(scope, "Schedules", {
    lambda,
    lag: settled.lag,
    namePrefix: settled.namePrefix,
    runs: summaryRuns(asking),
  });

  return {
    lambda,
    reportLambda,
    schedules: schedules.schedules,
    reportSchedule: new ReportSchedule(scope, "ReportSchedule", {
      lambda: reportLambda,
      role: schedules.role,
      lag: settled.reportLag,
      namePrefix: settled.namePrefix,
      run: {
        timeZone: settled.reportTimeZone,
        weekStartsOn: settled.reportWeekStartsOn,
        recomputedDays: settled.recomputedReportDays,
        granularities: settled.granularities,
        questions,
      },
    }).schedule,
    reportNotifications: createReportNotifications(
      scope,
      bucket,
      notifications,
      props.logRetention,
    ),
  };
}
