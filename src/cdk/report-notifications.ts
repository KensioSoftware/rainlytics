// SNS delivery started by a report notification manifest in S3.

import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { EventType, type IBucket } from "aws-cdk-lib/aws-s3";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
import { type ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

import { reportNotificationManifestPrefix } from "../report-notification-manifest.js";
import type { ReportNotificationConfiguration } from "./report-notification-configuration.js";
import { ReportNotificationFunction } from "./report-notification-function.js";
import type { SummariesBucket } from "./summary-bucket.js";

/** What the report notification resources need telling. */
export interface ReportNotificationsConstructProps {
  readonly bucket: SummariesBucket;
  readonly configuration: ReportNotificationConfiguration;
  readonly logRetention?: RetentionDays | undefined;
}

/** The topic and S3-triggered function for report notifications. */
export class ReportNotifications extends Construct {
  readonly topic: ITopic;
  readonly lambda: IFunction;
  readonly deadLetterQueue: IQueue;

  constructor(
    scope: Construct,
    id: string,
    props: ReportNotificationsConstructProps,
  ) {
    super(scope, id);

    const bucket = notifiableBucket(props.bucket);
    this.topic =
      props.configuration.topic ??
      new Topic(this, "Topic", {
        enforceSSL: true,
      });

    for (const email of props.configuration.emails) {
      this.topic.addSubscription(new EmailSubscription(email, { json: false }));
    }

    const notificationFunction = new ReportNotificationFunction(
      this,
      "Publisher",
      {
        bucket: props.bucket,
        topic: this.topic,
        configuration: props.configuration,
        ...(props.logRetention === undefined
          ? {}
          : { logRetention: props.logRetention }),
      },
    );
    this.lambda = notificationFunction.lambda;
    this.deadLetterQueue = notificationFunction.deadLetterQueue;

    bucket.addEventNotification(
      EventType.OBJECT_CREATED_PUT,
      new LambdaDestination(this.lambda),
      { prefix: reportNotificationManifestPrefix, suffix: ".json" },
    );
  }
}

/** Creates notification resources only for an enabled deployment. */
export function createReportNotifications(
  scope: Construct,
  bucket: SummariesBucket,
  configuration: ReportNotificationConfiguration | undefined,
  logRetention: RetentionDays | undefined,
): ReportNotifications | undefined {
  return configuration === undefined
    ? undefined
    : new ReportNotifications(scope, "Notifications", {
        bucket,
        configuration,
        ...(logRetention === undefined ? {} : { logRetention }),
      });
}

/** A real CDK Bucket can install an Object-created notification. */
function notifiableBucket(bucket: SummariesBucket): IBucket {
  if (!("addEventNotification" in bucket)) {
    throw new Error(
      "Report notifications need summariesBucket to be a CDK Bucket." +
        " The narrow custom bucket interface cannot install an S3 event" +
        " notification.",
    );
  }

  return bucket as IBucket;
}
