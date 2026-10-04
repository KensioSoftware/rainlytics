// The function that publishes one completed report notification.

import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { Queue, QueueEncryption, type IQueue } from "aws-cdk-lib/aws-sqs";
import { Duration, RemovalPolicy } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import type { ReportNotificationConfiguration } from "./report-notification-configuration.js";
import { reportNotificationLambdaEnvironment } from "./report-notification-environment.js";
import { reportNotificationPublisher } from "./report-notification-code.js";
import { reportSourceReadStatements } from "./summary-permissions.js";
import type { SummariesBucket } from "./summary-bucket.js";

/** What the report notification function needs telling. */
export interface ReportNotificationFunctionProps {
  readonly bucket: SummariesBucket;
  readonly topic: ITopic;
  readonly configuration: ReportNotificationConfiguration;
  readonly logRetention?: RetentionDays | undefined;
}

/** The Lambda function an S3 completion event invokes. */
export class ReportNotificationFunction extends Construct {
  readonly lambda: IFunction;
  readonly deadLetterQueue: IQueue;

  constructor(
    scope: Construct,
    id: string,
    props: ReportNotificationFunctionProps,
  ) {
    super(scope, id);

    this.deadLetterQueue = new Queue(this, "DeadLetters", {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });

    this.lambda = reportNotificationPublisher(
      this,
      "Function",
      {
        memorySize: 256,
        timeout: Duration.seconds(30),
        deadLetterQueue: this.deadLetterQueue,
        logGroup: new LogGroup(this, "Logs", {
          retention: props.logRetention ?? RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        environment: reportNotificationLambdaEnvironment(
          props.bucket,
          props.topic,
          props.configuration,
        ),
      },
      props.configuration.message,
    );

    // Missing previous reports need a 404 so the first digest can be sent.
    // https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
    for (const statement of reportSourceReadStatements(
      props.bucket,
      this.lambda,
    )) {
      this.lambda.addToRolePolicy(statement);
    }
    props.topic.grantPublish(this.lambda);
  }
}
