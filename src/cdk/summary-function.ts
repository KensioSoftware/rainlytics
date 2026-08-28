// The function that runs the questions and writes the answers.
//
// Small and single-purpose. It starts one query, waits for it and puts one
// object, once per window. Everything about what to count is in the SQL the
// schedule hands it, and everything about where to read and write is in the
// environment below.

import {
  Code,
  Function as LambdaFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Duration, RemovalPolicy } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import { summaryEnvironment } from "../functions/summary-deployment.js";
import { defaultVisitorSaltParameter } from "../visitor-identity.js";
import type { LogTable } from "./log-table.js";
import type { QueryWorkgroup } from "./query-workgroup.js";
import type { SummariesBucket } from "./summary-bucket.js";
import { summaryCodePath, summaryHandlerName } from "./summary-code.js";
import {
  athenaStatements,
  catalogStatements,
  logReadStatements,
  visitorSaltStatements,
} from "./summary-permissions.js";

/** What the summary function needs telling. */
export interface SummaryFunctionProps {
  /** The table its queries read. */
  readonly table: LogTable;

  /** The workgroup they run in. */
  readonly workgroup: QueryWorkgroup;

  /** The bucket the answers are written to. */
  readonly bucket: SummariesBucket;

  /** How many closed windows one run computes. */
  readonly windows: number;

  /**
   * The SSM parameter holding the visitor salt secret.
   *
   * @default `/rainlytics/visitor-salt`
   */
  readonly visitorSaltParameter?: string | undefined;

  /**
   * How long one run may take.
   *
   * A run is `windows` queries end to end, and each is a scan of one window
   * of one table. Five minutes is a wide margin over that, and a run still
   * going after it has met something worth failing on.
   *
   * @default five minutes
   */
  readonly timeout?: Duration | undefined;

  /**
   * How long the function's logs are kept.
   *
   * The log group is where a failed run is explained, and a scheduled job
   * fails while nobody is looking. A month is long enough to find out why the
   * summaries stopped last week.
   *
   * @default a month
   */
  readonly logRetention?: RetentionDays | undefined;
}

/**
 * The Lambda function one schedule invokes.
 *
 * ```typescript
 * const summaries = new SummaryFunction(this, "Summaries", { ... });
 * ```
 *
 * CommonJS out of `dist/lambda`, which is a second compilation of the same
 * source the package exports as ES modules. The AWS SDK comes from the
 * runtime, so the deployment package is the package's own code and nothing
 * else.
 *
 * 256 MB, and the function spends nearly all of its time waiting on Athena.
 * Memory buys speed of loading the SDK rather than speed of counting, and a
 * month of runs costs a few cents at any size in this range.
 */
export class SummaryFunction extends Construct {
  /** The function itself. */
  readonly lambda: LambdaFunction;

  constructor(scope: Construct, id: string, props: SummaryFunctionProps) {
    super(scope, id);

    const saltParameter =
      props.visitorSaltParameter ?? defaultVisitorSaltParameter;

    this.lambda = new LambdaFunction(this, "Function", {
      runtime: Runtime.NODEJS_22_X,
      handler: summaryHandlerName,
      code: Code.fromAsset(summaryCodePath()),
      memorySize: 256,
      timeout: props.timeout ?? Duration.minutes(5),
      logGroup: new LogGroup(this, "Logs", {
        retention: props.logRetention ?? RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        [summaryEnvironment.database]: props.table.dataset.databaseName,
        [summaryEnvironment.workgroup]: props.workgroup.workgroupName,
        [summaryEnvironment.bucket]: props.bucket.bucketName,
        [summaryEnvironment.windows]: String(props.windows),
        [summaryEnvironment.visitorSaltParameter]: saltParameter,
      },
    });

    for (const statement of [
      ...athenaStatements(this, props.workgroup.workgroupName),
      ...catalogStatements(this, props.table.dataset),
      ...logReadStatements(props.table.logBucket, this.lambda),
      ...visitorSaltStatements(this, saltParameter),
    ]) {
      this.lambda.addToRolePolicy(statement);
    }

    // Athena writes every query's output to the workgroup's results location
    // as the caller, and reads it back to answer GetQueryResults.
    props.workgroup.resultsBucket.grantReadWrite(this.lambda);
    props.bucket.grantPut(this.lambda);
  }
}
