// Lambda environment values for one report notification deployment.

import type { ITopic } from "aws-cdk-lib/aws-sns";

import { reportNotificationEnvironment } from "../functions/report-notification-deployment.js";
import { summaryEnvironment } from "../functions/summary-deployment.js";
import type { ReportNotificationConfiguration } from "./report-notification-configuration.js";
import type { SummariesBucket } from "./summary-bucket.js";

/** Serialises the notification settings handed to the publisher Lambda. */
export function reportNotificationLambdaEnvironment(
  bucket: SummariesBucket,
  topic: ITopic,
  configuration: ReportNotificationConfiguration,
): Readonly<Record<string, string>> {
  return {
    [summaryEnvironment.bucket]: bucket.bucketName,
    [reportNotificationEnvironment.topicArn]: topic.topicArn,
    [reportNotificationEnvironment.questions]:
      configuration.questions === undefined
        ? ""
        : JSON.stringify(configuration.questions),
    [reportNotificationEnvironment.maxRowsPerQuestion]: String(
      configuration.maxRowsPerQuestion,
    ),
    [reportNotificationEnvironment.subjectPrefix]: configuration.subjectPrefix,
  };
}
