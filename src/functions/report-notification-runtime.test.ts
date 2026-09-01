import {
  assertArrayLength,
  assertIdentical,
  assertStringIncludes,
  assertThrowsErrorAsync,
} from "@kensio/smartass";
import { text } from "node:stream/consumers";
import type { Readable } from "node:stream";

import { S3Client } from "@aws-sdk/client-s3";
import { SNSClient } from "@aws-sdk/client-sns";
import { faker } from "@faker-js/faker";
import { SimAws } from "@kensio/yulin";
import { SimSdk } from "@kensio/yulin/sdk";
import { describe, it, vi } from "vitest";

import {
  reportDayFactory,
  reportDocumentFactory,
  reportNotificationManifestFactory,
  reportNotificationS3RecordFactory,
} from "#test/report-notification-factories.js";

import { reportNotificationManifestKey } from "../report-notification-manifest.js";
import { previousReportPeriod, reportPeriod } from "../report-periods.js";
import { reportNotificationEnvironment } from "./report-notification-deployment.js";
import { reportNotificationObjectBody } from "./report-notification-object.js";
import { reportNotificationDocuments } from "./report-notification-report-documents.js";
import { writeReportNotificationIfReady } from "./report-notification-ready.js";
import { openReportStore } from "./report-store.js";
import { summaryEnvironment } from "./summary-deployment.js";

describe("the report notification runtime", () => {
  /** A bucket, topic and SDK interception in a fresh simulated account. */
  const deployment = async () => {
    const simAws = new SimAws();
    const account = simAws.region("us-east-1").account();
    const bucket = `rainlytics-summaries-${faker.string.uuid()}`;
    const phoneNumber = `+1555${faker.string.numeric(7)}`;
    await account.s3().createBucket({ input: { Bucket: bucket } });
    const created = await account.sns().createTopic({
      input: { Name: `reports-${faker.string.uuid()}` },
    });
    const topicArn = created.TopicArn;
    if (topicArn === undefined) {
      throw new Error("The simulated SNS topic has no ARN.");
    }
    await account.sns().subscribe({
      input: {
        TopicArn: topicArn,
        Protocol: "sms",
        Endpoint: phoneNumber,
      },
    });

    const sdk = new SimSdk({ simAws });
    sdk.intercept(S3Client);
    sdk.intercept(SNSClient);
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv(summaryEnvironment.bucket, bucket);
    vi.stubEnv(reportNotificationEnvironment.topicArn, topicArn);
    vi.stubEnv(reportNotificationEnvironment.questions, "");
    vi.stubEnv(reportNotificationEnvironment.maxRowsPerQuestion, "5");
    vi.stubEnv(reportNotificationEnvironment.subjectPrefix, "Site analytics");
    const { handler } = await import("./report-notification.js");

    return { simAws, account, bucket, phoneNumber, sdk, handler };
  };

  /** Stores one JSON notification input. */
  const putJson = async (
    deployed: Awaited<ReturnType<typeof deployment>>,
    key: string,
    value: unknown,
  ): Promise<void> => {
    await deployed.account.s3().putObject({
      input: {
        Bucket: deployed.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
      },
    });
  };

  it("reads adjacent reports and publishes one message for a repeated record", async () => {
    // Given a completion manifest and both adjacent report documents.
    const deployed = await deployment();
    try {
      const day = reportDayFactory.make();
      const previous = previousReportPeriod(day);
      const manifest = reportNotificationManifestFactory.make({
        closingDay: day,
        periods: [day],
      });
      const entry = manifest.reports[0];
      if (entry === undefined) {
        throw new Error("The manifest factory produced no report entry.");
      }
      const key = reportNotificationManifestKey(manifest);
      await putJson(deployed, key, manifest);
      await putJson(
        deployed,
        entry.key,
        reportDocumentFactory.make({ period: day, views: 120 }),
      );
      await putJson(
        deployed,
        entry.previousKey,
        reportDocumentFactory.make({ period: previous, views: 100 }),
      );
      const record = reportNotificationS3RecordFactory.make({
        bucket: deployed.bucket,
        key,
      });

      // When S3 delivers the same record twice in one event.
      vi.stubEnv(reportNotificationEnvironment.questions, '["pageviews"]');
      await deployed.handler({ Records: [record, record] });
      await deployed.simAws.backgroundTasksComplete();

      // Then SNS receives one plain message with the computed comparison.
      const messages = deployed.account.sns().sentSmsMessages();
      assertArrayLength(messages, 1);
      assertIdentical(messages[0].phoneNumber, deployed.phoneNumber);
      assertStringIncludes(messages[0].message, "views 120 pageviews (+20%)");
    } finally {
      deployed.sdk.restoreAll();
    }
  });

  it("publishes the first report without an adjacent document", async () => {
    // Given a manifest and current report in a deployment with no prior day.
    const deployed = await deployment();
    try {
      const day = reportDayFactory.make();
      const manifest = reportNotificationManifestFactory.make();
      const entry = manifest.reports[0];
      if (entry === undefined) {
        throw new Error("The manifest factory produced no report entry.");
      }
      const key = reportNotificationManifestKey(manifest);
      await putJson(deployed, key, manifest);
      await putJson(
        deployed,
        entry.key,
        reportDocumentFactory.make({ period: day }),
      );

      // When the S3 event invokes the publisher.
      await deployed.handler({
        Records: [
          reportNotificationS3RecordFactory.make({
            bucket: deployed.bucket,
            key,
          }),
        ],
      });
      await deployed.simAws.backgroundTasksComplete();

      // Then the current values still reach the topic with an explanation.
      const messages = deployed.account.sns().sentSmsMessages();
      assertArrayLength(messages, 1);
      assertStringIncludes(
        messages[0].message,
        "Comparison: no previous report was found.",
      );
    } finally {
      deployed.sdk.restoreAll();
    }
  });

  it("writes one completion object for the latest selected boundary", async () => {
    // Given a summaries bucket and the latest closed day.
    const deployed = await deployment();
    try {
      const store = await openReportStore(deployed.bucket);
      const day = reportDayFactory.make();

      // When the same successful report run announces the day twice.
      await writeReportNotificationIfReady([day], ["day"], store);
      await writeReportNotificationIfReady([day], ["day"], store);

      // Then the deterministic key still contains one valid manifest.
      const key = "report-notifications/v1/UTC/2026-08-31.json";
      const found = await deployed.account.s3().getObject({
        input: { Bucket: deployed.bucket, Key: key },
      });
      const manifest = JSON.parse(
        await text(found.Body as unknown as Readable),
      ) as { reports: readonly unknown[] };
      assertArrayLength(manifest.reports, 1);

      // And a later writer recognises an occupied deterministic key.
      const raceKey = "report-notifications/v1/UTC/race.json";
      const firstWrite = await store.writeNotification(
        raceKey,
        reportNotificationManifestFactory.make(),
      );
      const secondWrite = await store.writeNotification(
        raceKey,
        reportNotificationManifestFactory.make(),
      );
      assertStringIncludes(firstWrite, "written");
      assertStringIncludes(secondWrite, "already-exists");

      // And disabled or non-closing selections write nothing else.
      await writeReportNotificationIfReady([day], undefined, store);
      await writeReportNotificationIfReady([day], ["week"], store);
      const week = reportPeriod(
        {
          unit: "week",
          at: new Date("2026-08-31T12:00:00.000Z"),
          timeZone: "UTC",
          weekStartsOn: "monday",
        },
        new Date("2026-09-07T00:30:00.000Z"),
      );
      const missingDay = assertThrowsErrorAsync(() =>
        writeReportNotificationIfReady([week], ["day"], store),
      );
      const missingDayError = await missingDay;
      assertStringIncludes(missingDayError.message, "no closed day");

      // And unexpected S3 failures and malformed adjacent reports propagate.
      const missingBucket = new S3Client({ region: "us-east-1" });
      const missingBucketError = await assertThrowsErrorAsync(() =>
        reportNotificationObjectBody(
          missingBucket,
          `absent-${faker.string.uuid()}`,
          "report.json",
        ),
      );
      assertStringIncludes(missingBucketError.name, "NoSuchBucket");
      const entry = reportNotificationManifestFactory.make().reports[0];
      if (entry === undefined) {
        throw new Error("The manifest factory produced no report entry.");
      }
      await putJson(deployed, entry.key, reportDocumentFactory.make());
      await putJson(deployed, entry.previousKey, { malformed: true });
      const malformedPrevious = await assertThrowsErrorAsync(() =>
        reportNotificationDocuments(
          new S3Client({ region: "us-east-1" }),
          deployed.bucket,
          entry,
        ),
      );
      assertStringIncludes(malformedPrevious.message, entry.previousKey);
      store.close();
    } finally {
      deployed.sdk.restoreAll();
    }
  });
});
