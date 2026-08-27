// The schedules that fire the job, one per question per cadence.
//
// One schedule per pair rather than one for all of them, because a schedule
// carries the question in its target input and that is where the SQL travels.
// It also means a question that fails takes its own run down and leaves the
// rest computing, and that the two cadences of one question can be read apart
// in the console.

import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { Duration } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import type { SummaryRun } from "../functions/summary-run.js";
import { savedQueryPrefix } from "../dataset.js";
import type { SummaryGranularity } from "../summary-windows.js";
import { summaryScheduleExpression } from "./summary-lag.js";
import { scheduleId } from "./summary-schedule-names.js";

/** What the schedules need telling. */
export interface SummarySchedulesProps {
  /** The function they invoke. */
  readonly lambda: IFunction;

  /** How long after a window closes each run fires. */
  readonly lag: Duration;

  /** Every question on every cadence, one schedule each. */
  readonly runs: readonly SummaryRun[];
}

/**
 * The schedules of one deployment, and the role they invoke through.
 *
 * EventBridge Scheduler assumes a role of its own to reach a target, so this
 * is a role admitting `scheduler.amazonaws.com` and allowed to invoke the one
 * function. That is the whole of what a schedule can do here.
 *
 * Every schedule is `mode: "OFF"`, so a run happens at the minute the
 * expression names. A flexible window would let Scheduler move a run by up to
 * an hour, which on an hourly cadence is a run computing a window it has
 * already computed while the one that closed since goes uncomputed until the
 * next firing.
 */
export class SummarySchedules extends Construct {
  /** The schedules, in the order the runs were given. */
  readonly schedules: readonly CfnSchedule[];

  /** The role Scheduler assumes to invoke the function. */
  readonly role: Role;

  constructor(scope: Construct, id: string, props: SummarySchedulesProps) {
    super(scope, id);

    this.role = new Role(this, "Role", {
      assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
      description: "Lets EventBridge Scheduler run the Rainlytics rollups.",
    });
    props.lambda.grantInvoke(this.role);

    this.schedules = props.runs.map((run) => this.fire(run, props));
  }

  private fire(run: SummaryRun, props: SummarySchedulesProps): CfnSchedule {
    return new CfnSchedule(this, scheduleId(run), {
      name: scheduleName(run.question.name, run.granularity),
      description:
        `Rainlytics ${run.question.name}, computed for each` +
        ` ${run.granularity === "hourly" ? "hour" : "day"} that closes.`,
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: summaryScheduleExpression(run.granularity, props.lag),
      // The windows underneath are UTC and so is the run that computes them.
      scheduleExpressionTimezone: "UTC",
      target: {
        arn: props.lambda.functionArn,
        roleArn: this.role.roleArn,
        input: JSON.stringify(run),
      },
    });
  }
}

/**
 * What one schedule is called.
 *
 * The same `rainlytics-` prefix the saved queries take. Scheduler lists
 * schedules flat within a group, and the prefix gathers a deployment's own
 * into one place among whatever else somebody has scheduled there.
 */
function scheduleName(
  question: string,
  granularity: SummaryGranularity,
): string {
  return `${savedQueryPrefix}${question}-${granularity}`;
}
