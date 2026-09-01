// Reading the current and previous documents for one notification report.

import type { S3Client } from "@aws-sdk/client-s3";

import type { ReportNotificationManifestEntry } from "../report-notification-manifest.js";
import type { ReportNotificationReport } from "../report-notification-message.js";
import type { ReportDocument } from "../report-document.js";
import { previousReportPeriod } from "../report-periods.js";
import {
  isMissingReportNotificationObject,
  reportNotificationObjectBody,
} from "./report-notification-object.js";
import { notificationReportDocumentFrom } from "./report-notification-report-reading.js";

/** Current and optional previous documents for one manifest entry. */
export async function reportNotificationDocuments(
  client: S3Client,
  bucket: string,
  entry: ReportNotificationManifestEntry,
): Promise<ReportNotificationReport> {
  const current = notificationReportDocumentFrom(
    await reportNotificationObjectBody(client, bucket, entry.key),
    entry.key,
    entry.period,
  );
  const previous = await previousReport(client, bucket, entry);

  return {
    entry,
    current,
    ...(previous === undefined ? {} : { previous }),
  };
}

/** The adjacent report, or no value for the first report of its kind. */
async function previousReport(
  client: S3Client,
  bucket: string,
  entry: ReportNotificationManifestEntry,
): Promise<ReportDocument | undefined> {
  try {
    return notificationReportDocumentFrom(
      await reportNotificationObjectBody(client, bucket, entry.previousKey),
      entry.previousKey,
      previousReportPeriod(entry.period),
    );
  } catch (error) {
    if (isMissingReportNotificationObject(error)) {
      return undefined;
    }
    throw error;
  }
}
