import { MappedFactory, StaticFactory } from "@kensio/part-factory";

import type { ReportDocument } from "../src/report-document.js";
import {
  type ReportDayPeriod,
  reportNotificationManifest,
  type ReportNotificationManifest,
} from "../src/report-notification-manifest.js";
import type { ReportPeriod } from "../src/report-periods.js";
import type { SummaryQuestion } from "../src/rollup-summaries.js";

export const reportDayFactory = new StaticFactory<ReportDayPeriod>({
  unit: "day",
  timeZone: "UTC",
  startsOn: "2026-08-31",
  endsBefore: "2026-09-01",
  from: "2026-08-31T00:00:00.000Z",
  until: "2026-09-01T00:00:00.000Z",
});

interface ReportDocumentParts {
  readonly period: ReportPeriod;
  readonly views: number;
  readonly visitors: number;
}

const question: SummaryQuestion = {
  name: "pageviews",
  includeBots: false,
  limit: 20,
  param: "q",
  redirectStatuses: ["302", "303", "307"],
};

export const reportDocumentFactory = new MappedFactory<
  ReportDocumentParts,
  ReportDocument
>(
  () => ({ period: reportDayFactory.make(), views: 120, visitors: 60 }),
  ({ period, views, visitors }) => ({
    schemaVersion: 1,
    period,
    sourceCoverage: {
      from: period.from,
      until: period.until,
      complete: true,
    },
    computedAt: new Date(Date.parse(period.until) + 1_800_000).toISOString(),
    sections: [
      {
        question,
        accuracy: "exact",
        composition: "period-query",
        source: {
          from: period.from,
          until: period.until,
          summaries: 1,
          complete: true,
        },
        value: {
          type: "rows",
          columns: ["path", "views"],
          rows: [{ path: "/", views: String(views) }],
        },
      },
      {
        question,
        accuracy: "exact",
        composition: "period-query",
        source: {
          from: period.from,
          until: period.until,
          summaries: 0,
          queries: 1,
          complete: true,
        },
        value: {
          type: "visitor-count",
          count: { distinct: visitors, additive: false },
        },
      },
    ],
  }),
);

interface ManifestParts {
  readonly closingDay: ReportDayPeriod;
  readonly periods: readonly ReportPeriod[];
  readonly createdAt: Date;
}

export const reportNotificationManifestFactory = new MappedFactory<
  ManifestParts,
  ReportNotificationManifest
>(
  () => {
    const closingDay = reportDayFactory.make();
    return {
      closingDay,
      periods: [closingDay],
      createdAt: new Date("2026-09-01T00:30:00.000Z"),
    };
  },
  (parts) => reportNotificationManifest(parts),
);

interface S3RecordParts {
  readonly bucket: string;
  readonly key: string;
  readonly eventName: string;
}

export const reportNotificationS3RecordFactory = new MappedFactory<
  S3RecordParts,
  Readonly<Record<string, unknown>>
>(
  () => ({
    bucket: "summaries-example",
    key: "report-notifications/v1/UTC/2026-08-31.json",
    eventName: "ObjectCreated:Put",
  }),
  ({ bucket, key, eventName }) => ({
    eventName,
    s3: {
      bucket: { name: bucket },
      object: { key: encodeURIComponent(key).replaceAll("%20", "+") },
    },
  }),
);
