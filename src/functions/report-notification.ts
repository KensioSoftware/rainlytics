// The S3-triggered job that publishes plain-text calendar report summaries.

import { S3Client } from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

import { reportNotificationMessage } from "../report-notification-message.js";
import { summaryEnvironment } from "./summary-deployment.js";
import { reportNotificationDeploymentFrom } from "./report-notification-deployment.js";
import { reportNotificationKeysFrom } from "./report-notification-event.js";
import { reportNotificationObjectBody } from "./report-notification-object.js";
import { reportNotificationManifestFrom } from "./report-notification-reading.js";
import { reportNotificationDocuments } from "./report-notification-report-documents.js";

const s3Client = new S3Client({});
const snsClient = new SNSClient({});

/** Publishes one message for each notification manifest in an S3 event. */
export async function handler(event: unknown): Promise<void> {
  const deployment = reportNotificationDeploymentFrom(
    process.env,
    summaryEnvironment.bucket,
  );
  const keys = reportNotificationKeysFrom(event, deployment.bucket);

  for (const key of keys) {
    // S3 event records are independent. Keeping them sequential avoids a
    // single invocation publishing several messages at once after a retry.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const body = await reportNotificationObjectBody(
      s3Client,
      deployment.bucket,
      key,
    );
    const manifest = reportNotificationManifestFrom(body, key);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const reports = await Promise.all(
      manifest.reports.map((entry) =>
        reportNotificationDocuments(s3Client, deployment.bucket, entry),
      ),
    );
    const notification = reportNotificationMessage({
      manifest,
      bucket: deployment.bucket,
      reports,
      ...(deployment.questions === undefined
        ? {}
        : { questions: deployment.questions }),
      maxRowsPerQuestion: deployment.maxRowsPerQuestion,
      subjectPrefix: deployment.subjectPrefix,
    });

    // oxlint-disable-next-line eslint/no-await-in-loop
    const published = await snsClient.send(
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
}
