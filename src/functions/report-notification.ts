// The S3-triggered job that publishes plain-text calendar report summaries.

import { S3Client } from "@aws-sdk/client-s3";
import { SNSClient } from "@aws-sdk/client-sns";

import {
  type ReportNotificationMessageFunction,
  reportNotificationMessage,
} from "../report-notification-message.js";
import { summaryEnvironment } from "./summary-deployment.js";
import { reportNotificationDeploymentFrom } from "./report-notification-deployment.js";
import { reportNotificationKeysFrom } from "./report-notification-event.js";
import { publishReportNotification } from "./report-notification-publish.js";

/** What a site's own notification publisher changes. */
export interface ReportNotificationHandlerOptions {
  /**
   * Writes the subject and body from the manifest and its compared reports.
   *
   * @default reportNotificationMessage
   */
  readonly message?: ReportNotificationMessageFunction | undefined;
}

/**
 * A notification publisher Lambda handler.
 *
 * Rainlytics deploys one built with the default message. A site writing its
 * own message exports one of these from the entry it names in
 * `reportNotifications.message`, and keeps the manifest trigger, the report
 * reading, the comparisons and the SNS publish.
 */
export function reportNotificationHandler(
  options: ReportNotificationHandlerOptions = {},
): (event: unknown) => Promise<void> {
  const message = options.message ?? reportNotificationMessage;
  const s3Client = new S3Client({});
  const snsClient = new SNSClient({});

  return async (event) => {
    const deployment = reportNotificationDeploymentFrom(
      process.env,
      summaryEnvironment.bucket,
    );
    const publisher = { s3: s3Client, sns: snsClient, deployment, message };

    for (const key of reportNotificationKeysFrom(event, deployment.bucket)) {
      // S3 event records are independent. Keeping them sequential avoids a
      // single invocation publishing several messages at once after a retry.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await publishReportNotification(publisher, key);
    }
  };
}

/** Publishes one message for each notification manifest in an S3 event. */
export const handler = reportNotificationHandler();
