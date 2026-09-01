import {
  assertArrayLength,
  assertFalse,
  assertObjectEquals,
  assertStringIncludes,
  assertThrowsError,
  assertUndefined,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import {
  reportDayFactory,
  reportDocumentFactory,
  reportNotificationManifestFactory,
  reportNotificationS3RecordFactory,
} from "#test/report-notification-factories.js";

import { reportNotificationManifestKey } from "../report-notification-manifest.js";
import { previousReportPeriod } from "../report-periods.js";
import {
  reportNotificationDeploymentFrom,
  reportNotificationEnvironment,
  reportWriterNotificationDeploymentFrom,
} from "./report-notification-deployment.js";
import { reportNotificationKeysFrom } from "./report-notification-event.js";
import { reportNotificationManifestFrom } from "./report-notification-reading.js";
import { notificationReportDocumentFrom } from "./report-notification-report-reading.js";
import { isNotificationReportPeriod } from "./report-notification-input.js";

describe("report notification Lambda inputs", () => {
  it("reads the writer and publisher settings produced by the construct", () => {
    // Given a complete Lambda environment from RollupSummaries.
    const environment = {
      BUCKET: "summaries-example",
      [reportNotificationEnvironment.periods]: '["day","week"]',
      [reportNotificationEnvironment.topicArn]:
        "arn:aws:sns:us-east-1:123456789012:reports",
      [reportNotificationEnvironment.questions]: '["pageviews"]',
      [reportNotificationEnvironment.maxRowsPerQuestion]: "5",
      [reportNotificationEnvironment.subjectPrefix]: "Example analytics",
    };

    // When both jobs read their part of it.
    const writer = reportWriterNotificationDeploymentFrom(environment);
    const publisher = reportNotificationDeploymentFrom(environment, "BUCKET");

    // Then the values retain their types, including optional questions.
    assertObjectEquals(writer, { periods: ["day", "week"] });
    assertObjectEquals(publisher, {
      bucket: "summaries-example",
      topicArn: "arn:aws:sns:us-east-1:123456789012:reports",
      questions: ["pageviews"],
      maxRowsPerQuestion: 5,
      subjectPrefix: "Example analytics",
    });
    assertUndefined(reportWriterNotificationDeploymentFrom({}));

    const everyQuestion = reportNotificationDeploymentFrom(
      { ...environment, [reportNotificationEnvironment.questions]: "" },
      "BUCKET",
    );
    assertUndefined(everyQuestion.questions);
  });

  it("refuses deployment values that a construct could not have produced", () => {
    // Given malformed, empty and incomplete environment values.
    const complete = {
      BUCKET: "summaries-example",
      [reportNotificationEnvironment.topicArn]: "topic",
      [reportNotificationEnvironment.questions]: "",
      [reportNotificationEnvironment.maxRowsPerQuestion]: "5",
      [reportNotificationEnvironment.subjectPrefix]: "Rainlytics",
    };
    const invalid = [
      () =>
        reportWriterNotificationDeploymentFrom({
          [reportNotificationEnvironment.periods]: "not-json",
        }),
      () =>
        reportWriterNotificationDeploymentFrom({
          [reportNotificationEnvironment.periods]: "[]",
        }),
      () =>
        reportWriterNotificationDeploymentFrom({
          [reportNotificationEnvironment.periods]: '["day",1]',
        }),
      () => reportNotificationDeploymentFrom({}, "BUCKET"),
      () =>
        reportNotificationDeploymentFrom(
          {
            ...complete,
            [reportNotificationEnvironment.maxRowsPerQuestion]: "0",
          },
          "BUCKET",
        ),
      () =>
        reportNotificationDeploymentFrom(
          {
            ...complete,
            [reportNotificationEnvironment.questions]: "not-json",
          },
          "BUCKET",
        ),
    ];

    // When each value is read, then it is rejected before any AWS call.
    for (const reading of invalid) {
      assertStringIncludes(
        assertThrowsError(reading).message,
        "report notification job",
      );
    }
  });

  it("selects, decodes and deduplicates manifest records", () => {
    // Given two copies of an S3 record whose key contains an encoded time zone.
    const key = "report-notifications/v1/Europe%2FLondon/2026-08-31.json";
    const record = reportNotificationS3RecordFactory.make({
      bucket: "summaries-example",
      key,
    });

    // When the notification job selects its keys.
    const keys = reportNotificationKeysFrom(
      { Records: [record, record] },
      "summaries-example",
    );

    // Then the decoded manifest is handled once.
    assertObjectEquals(keys, [key]);
  });

  it("refuses malformed or unrelated S3 events", () => {
    // Given events missing each required part of an Object-created record.
    const valid = reportNotificationS3RecordFactory.make();
    const invalid = [
      undefined,
      {},
      { Records: [] },
      { Records: [null] },
      { Records: [{}] },
      { Records: [{ ...valid, eventName: "ObjectRemoved:Delete" }] },
      {
        Records: [
          reportNotificationS3RecordFactory.make({ bucket: "another" }),
        ],
      },
      {
        Records: [
          reportNotificationS3RecordFactory.make({ key: "reports/day.json" }),
        ],
      },
    ];

    // When each event is selected, then it is refused as untrusted input.
    for (const event of invalid) {
      assertThrowsError(() =>
        reportNotificationKeysFrom(event, "summaries-example"),
      );
    }
  });

  it("validates manifests and the report documents they select", () => {
    // Given one generated manifest and matching current report.
    const manifest = reportNotificationManifestFactory.make();
    const key = reportNotificationManifestKey(manifest);
    const period = reportDayFactory.make();
    const report = reportDocumentFactory.make({ period });

    // When both documents are read back from their JSON representation.
    const readManifest = reportNotificationManifestFrom(
      JSON.stringify(manifest),
      key,
    );
    const readReport = notificationReportDocumentFrom(
      JSON.stringify(report),
      manifest.reports[0]?.key ?? "missing",
      period,
    );

    // Then the trusted values retain the stored document shapes.
    assertArrayLength(readManifest.reports, 1);
    assertObjectEquals(readReport.period, period);
  });

  it("refuses malformed and mismatched stored documents", () => {
    // Given a valid pair and variants that violate their stored invariants.
    const manifest = reportNotificationManifestFactory.make();
    const key = reportNotificationManifestKey(manifest);
    const period = reportDayFactory.make();
    const report = reportDocumentFactory.make({ period });
    const previous = previousReportPeriod(period);
    const entry = manifest.reports[0];
    if (entry === undefined) {
      throw new Error("The factory produced no report entry.");
    }

    const badManifests: readonly [unknown, string][] = [
      ["not-json", key],
      [[], key],
      [{ ...manifest, kind: "other" }, key],
      [{ ...manifest, createdAt: "not-a-date" }, key],
      [{ ...manifest, reports: [] }, key],
      [manifest, `${key}.wrong`],
      [{ ...manifest, reports: [entry, entry] }, key],
      [{ ...manifest, reports: [{ ...entry, key: "wrong" }] }, key],
      [{ ...manifest, reports: [null] }, key],
    ];
    const badReports = [
      "not-json",
      JSON.stringify([]),
      JSON.stringify({ ...report, schemaVersion: 99 }),
      JSON.stringify({ ...report, computedAt: "not-a-date" }),
      JSON.stringify({ ...report, sections: null }),
      JSON.stringify({ ...report, period: previous }),
    ];

    // When any variant is read, then the S3 key is present in its diagnostic.
    for (const [body, bodyKey] of badManifests) {
      const encoded = typeof body === "string" ? body : JSON.stringify(body);
      assertStringIncludes(
        assertThrowsError(() =>
          reportNotificationManifestFrom(encoded, bodyKey),
        ).message,
        bodyKey,
      );
    }
    for (const body of badReports) {
      assertStringIncludes(
        assertThrowsError(() =>
          notificationReportDocumentFrom(body, entry.key, period),
        ).message,
        entry.key,
      );
    }

    // And the shared period guard rejects non-objects and incomplete weeks.
    assertFalse(isNotificationReportPeriod(null));
    assertFalse(
      isNotificationReportPeriod(
        { ...period, unit: "week", weekStartsOn: undefined },
        "week",
      ),
    );
  });
});
