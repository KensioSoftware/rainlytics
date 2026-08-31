// The daily schedule that writes every calendar period closing that day.

import type { IRole } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import type { Duration } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import type { ReportRun } from "../functions/report-run.js";
import { reportScheduleExpression } from "./report-lag.js";

/** What the calendar report schedule needs telling. */
export interface ReportScheduleProps {
  readonly lambda: IFunction;
  readonly role: IRole;
  readonly lag: Duration;
  readonly namePrefix: string;
  readonly run: ReportRun;
}

/** One daily report schedule, using the summary schedules' execution role. */
export class ReportSchedule extends Construct {
  readonly schedule: CfnSchedule;

  constructor(scope: Construct, id: string, props: ReportScheduleProps) {
    super(scope, id);

    props.lambda.grantInvoke(props.role);
    this.schedule = new CfnSchedule(this, "Schedule", {
      name: `${props.namePrefix}_reports-daily`,
      description:
        "Rainlytics calendar reports for each local day, week, month and year that closes.",
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: reportScheduleExpression(props.lag),
      scheduleExpressionTimezone: props.run.timeZone,
      target: {
        arn: props.lambda.functionArn,
        roleArn: props.role.roleArn,
        input: JSON.stringify(props.run),
      },
    });
  }
}
