// The function that assembles and writes calendar report documents.

import {
  Code,
  Function as LambdaFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Duration, RemovalPolicy } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import type { ReportPeriodUnit } from "../report-periods.js";
import { defaultVisitorSaltParameter } from "../visitor-identity.js";
import type { LogTable } from "./log-table.js";
import type { QueryWorkgroup } from "./query-workgroup.js";
import type { SummariesBucket } from "./summary-bucket.js";
import { reportHandlerName, summaryCodePath } from "./summary-code.js";
import { reportFunctionEnvironment } from "./report-function-environment.js";
import {
  summaryJobStatements,
  summaryReadStatements,
} from "./summary-permissions.js";

/** What the report function needs telling. */
export interface ReportFunctionProps {
  readonly table: LogTable;
  readonly workgroup: QueryWorkgroup;
  readonly bucket: SummariesBucket;
  readonly countsVisitors: boolean;
  readonly notificationPeriods?: readonly ReportPeriodUnit[] | undefined;
  readonly visitorSaltParameter?: string | undefined;
  readonly timeout?: Duration | undefined;
  readonly logRetention?: RetentionDays | undefined;
}

/** The Lambda function one daily report schedule invokes. */
export class ReportFunction extends Construct {
  readonly lambda: LambdaFunction;

  constructor(scope: Construct, id: string, props: ReportFunctionProps) {
    super(scope, id);

    const saltParameter =
      props.visitorSaltParameter ?? defaultVisitorSaltParameter;

    this.lambda = new LambdaFunction(this, "Function", {
      runtime: Runtime.NODEJS_22_X,
      handler: reportHandlerName,
      code: Code.fromAsset(summaryCodePath()),
      memorySize: 512,
      timeout: props.timeout ?? Duration.minutes(15),
      logGroup: new LogGroup(this, "Logs", {
        retention: props.logRetention ?? RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: reportFunctionEnvironment({
        table: props.table,
        workgroup: props.workgroup,
        bucket: props.bucket,
        saltParameter,
        notificationPeriods: props.notificationPeriods,
      }),
    });

    for (const statement of [
      ...summaryJobStatements(this, {
        workgroup: props.workgroup,
        table: props.table,
        grantee: this.lambda,
        saltParameter,
        countsVisitors: props.countsVisitors,
      }),
      ...summaryReadStatements(props.bucket, this.lambda),
    ]) {
      this.lambda.addToRolePolicy(statement);
    }

    props.bucket.grantPut(this.lambda);
  }
}
