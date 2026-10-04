// Publishing the notification for one completion manifest.

import type { S3Client } from "@aws-sdk/client-s3";
import { PublishCommand, type SNSClient } from "@aws-sdk/client-sns";

import type { ReportNotificationMessageFunction } from "../report-notification-message.js";
import type { ReportNotificationDeployment } from "./report-notification-deployment.js";
import { reportNotificationObjectBody } from "./report-notification-object.js";
import { publishableReportNotification } from "./report-notification-publishable.js";
import { reportNotificationManifestFrom } from "./report-notification-reading.js";
import { reportNotificationDocuments } from "./report-notification-report-documents.js";

/** The clients and settings one publisher invocation shares. */
export interface ReportNotificationPublisher {
  readonly s3: S3Client;
  readonly sns: SNSClient;
  readonly deployment: ReportNotificationDeployment;
  readonly message: ReportNotificationMessageFunction;
}

/** Reads one manifest and its reports, writes the message and publishes it. */
export async function publishReportNotification(
  publisher: ReportNotificationPublisher,
  key: string,
): Promise<void> {
  const { deployment } = publisher;
  const body = await reportNotificationObjectBody(
    publisher.s3,
    deployment.bucket,
    key,
  );
  const manifest = reportNotificationManifestFrom(body, key);
  const reports = await Promise.all(
    manifest.reports.map((entry) =>
      reportNotificationDocuments(publisher.s3, deployment.bucket, entry),
    ),
  );
  const notification = publishableReportNotification(
    await publisher.message({
      manifest,
      bucket: deployment.bucket,
      reports,
      ...(deployment.questions === undefined
        ? {}
        : { questions: deployment.questions }),
      maxRowsPerQuestion: deployment.maxRowsPerQuestion,
      subjectPrefix: deployment.subjectPrefix,
    }),
    key,
  );

  const published = await publisher.sns.send(
    new PublishCommand({
      TopicArn: deployment.topicArn,
      Subject: notification.subject,
      Message: notification.message,
    }),
  );

  // oxlint-disable-next-line no-console
  console.info(
    JSON.stringify({
      event: "calendar-report-notification-published",
      manifestKey: key,
      messageId: published.MessageId,
      reports: reports.map(({ entry }) => entry.period.unit),
    }),
  );
}
