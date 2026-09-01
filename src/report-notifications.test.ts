import {
  assertIdentical,
  assertStringIncludes,
  assertThrowsError,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { availableMetric } from "./report-comparison-changes.js";
import type { ReportDocument } from "./report-document.js";
import { reportNotificationHeading } from "./report-notification-heading.js";
import {
  type ReportDayPeriod,
  reportNotificationManifest,
  reportNotificationManifestKey,
} from "./report-notification-manifest.js";
import { reportNotificationMessage } from "./report-notification-message.js";
import { reportNotificationMetricLines } from "./report-notification-metric-lines.js";
import {
  reportNotificationSectionHeading,
  reportNotificationSectionLines,
} from "./report-notification-section-lines.js";
import { limitedReportNotificationMessage } from "./report-notification-size.js";
import {
  previousReportPeriod,
  reportPeriod,
  type ReportPeriod,
} from "./report-periods.js";
import type { ReportSection } from "./report-section-types.js";
import type { SummaryQuestion } from "./rollup-summaries.js";

describe("calendar report notifications", () => {
  const question: SummaryQuestion = {
    name: "pageviews",
    includeBots: false,
    limit: 20,
    param: "q",
    redirectStatuses: ["302", "303", "307"],
  };

  const source = (period: ReportPeriod) => ({
    from: period.from,
    until: period.until,
    summaries: 1,
    complete: true,
  });

  const sections = (
    period: ReportPeriod,
    views: number,
    visitors: number,
  ): readonly ReportSection[] => [
    {
      question,
      accuracy: "exact",
      composition: "period-query",
      source: source(period),
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
      source: source(period),
      value: {
        type: "visitor-count",
        count: { distinct: visitors, additive: false },
      },
    },
  ];

  const document = (
    period: ReportPeriod,
    views: number,
    visitors: number,
  ): ReportDocument => ({
    schemaVersion: 1,
    period,
    sourceCoverage: {
      from: period.from,
      until: period.until,
      complete: true,
    },
    computedAt: new Date(Date.parse(period.until) + 1_800_000).toISOString(),
    sections: sections(period, views, visitors),
  });

  const closedDay = reportPeriod(
    {
      unit: "day",
      at: new Date("2026-08-31T12:00:00.000Z"),
      timeZone: "UTC",
    },
    new Date("2026-09-01T00:30:00.000Z"),
  ) as ReportDayPeriod;

  it("addresses one completion manifest per closed local day", () => {
    // Given a day report ready after its local boundary.
    // When its notification manifest is built.
    const manifest = reportNotificationManifest({
      closingDay: closedDay,
      periods: [closedDay],
      createdAt: new Date("2026-09-01T00:30:00.000Z"),
    });
    const entry = manifest.reports[0];
    if (entry === undefined) {
      throw new Error("The notification manifest has no day report.");
    }

    // Then it names both adjacent report objects under one deterministic key.
    assertIdentical(
      reportNotificationManifestKey(manifest),
      "report-notifications/v1/UTC/2026-08-31.json",
    );
    assertIdentical(entry.key, "reports/v1/UTC/day/2026-08-31.json");
    assertIdentical(entry.previousKey, "reports/v1/UTC/day/2026-08-30.json");
  });

  it("refuses reports that close at another boundary", () => {
    // Given a notification day and the day before it.
    const previous = previousReportPeriod(closedDay);

    // When both are put in one completion manifest.
    const building = () =>
      reportNotificationManifest({
        closingDay: closedDay,
        periods: [closedDay, previous],
        createdAt: new Date("2026-09-01T00:30:00.000Z"),
      });

    // Then the manifest refuses to combine two daily sends.
    const error = assertThrowsError(building);
    assertStringIncludes(error.message, "another boundary");
  });

  it("renders current values with their adjacent-period changes", () => {
    // Given today's report, yesterday's report and their completion manifest.
    const previous = previousReportPeriod(closedDay);
    const manifest = reportNotificationManifest({
      closingDay: closedDay,
      periods: [closedDay],
      createdAt: new Date("2026-09-01T00:30:00.000Z"),
    });
    const entry = manifest.reports[0];
    if (entry === undefined) {
      throw new Error("The notification manifest has no day report.");
    }

    // When the reports are rendered as an SNS message.
    const notification = reportNotificationMessage({
      manifest,
      bucket: "summaries-example",
      reports: [
        {
          entry,
          current: document(closedDay, 120, 60),
          previous: document(previous, 100, 50),
        },
      ],
      maxRowsPerQuestion: 5,
      subjectPrefix: "Site analytics",
    });

    // Then the subject identifies the closed day and the body carries data,
    // relative changes and the source object.
    assertIdentical(
      notification.subject,
      "Site analytics reports through 2026-08-31",
    );
    assertStringIncludes(notification.message, "views 120 pageviews (+20%)");
    assertStringIncludes(notification.message, "distinct 60 visitors (+20%)");
    assertStringIncludes(
      notification.message,
      "s3://summaries-example/reports/v1/UTC/day/2026-08-31.json",
    );
  });

  it("still reports current values when no previous report exists", () => {
    // Given the first daily report in a deployment.
    const manifest = reportNotificationManifest({
      closingDay: closedDay,
      periods: [closedDay],
      createdAt: new Date("2026-09-01T00:30:00.000Z"),
    });
    const entry = manifest.reports[0];
    if (entry === undefined) {
      throw new Error("The notification manifest has no day report.");
    }

    // When it is rendered without a previous document.
    const notification = reportNotificationMessage({
      manifest,
      bucket: "summaries-example",
      reports: [{ entry, current: document(closedDay, 7, 4) }],
      maxRowsPerQuestion: 5,
      subjectPrefix: "Rainlytics",
    });

    // Then the body explains the missing comparison and keeps today's data.
    assertStringIncludes(
      notification.message,
      "Comparison: no previous report was found.",
    );
    assertStringIncludes(notification.message, "path=/, views=7");
  });

  it("refuses impossible completion manifests", () => {
    // Given invalid creation times, empty reports and duplicate report units.
    const invalid = [
      () =>
        reportNotificationManifest({
          closingDay: closedDay,
          periods: [closedDay],
          createdAt: new Date("invalid"),
        }),
      () =>
        reportNotificationManifest({
          closingDay: closedDay,
          periods: [],
          createdAt: new Date("2026-09-01T00:30:00.000Z"),
        }),
      () =>
        reportNotificationManifest({
          closingDay: closedDay,
          periods: [closedDay],
          createdAt: new Date("2026-08-31T23:59:59.000Z"),
        }),
      () =>
        reportNotificationManifest({
          closingDay: closedDay,
          periods: [closedDay, closedDay],
          createdAt: new Date("2026-09-01T00:30:00.000Z"),
        }),
    ];

    // When they are built, then none can become an S3 trigger document.
    for (const building of invalid) {
      assertThrowsError(building);
    }
  });

  it("formats unavailable, empty and shortened section values", () => {
    // Given unavailable, approximate, empty and longer report sections.
    const period = closedDay;
    const base = sections(period, 1, 2);
    const rowSection = base[0];
    const visitorSection = base[1];
    if (rowSection === undefined || visitorSection === undefined) {
      throw new Error("The report fixture has no sections.");
    }
    const unavailable: ReportSection = {
      question,
      accuracy: "unavailable",
      composition: "none",
      reason: "incomplete-source",
      source: source(period),
      value: null,
    };
    const approximate: ReportSection = {
      question,
      accuracy: "approximate",
      composition: "ranked-summaries",
      source: source(period),
      value: { type: "rows", columns: ["path", "views"], rows: [] },
    };
    const manyRows: ReportSection = {
      question,
      accuracy: "exact",
      composition: "period-query",
      source: source(period),
      value: {
        type: "rows",
        columns: ["path", "views"],
        rows: [
          { path: "/one", views: "2" },
          { path: "/two", views: "1" },
        ],
      },
    };

    // When each is rendered directly.
    const unavailableLines = reportNotificationSectionLines(
      unavailable,
      undefined,
      5,
    );
    const emptyLines = reportNotificationSectionLines(
      approximate,
      undefined,
      5,
    );
    const shortened = reportNotificationSectionLines(manyRows, undefined, 1);
    const visitorLines = reportNotificationSectionLines(
      visitorSection,
      undefined,
      5,
    );

    // Then the text states the traits and never invents a comparison.
    assertStringIncludes(
      reportNotificationSectionHeading(approximate),
      "approximate",
    );
    assertStringIncludes(
      reportNotificationSectionHeading(visitorSection),
      "visitors",
    );
    assertIdentical(reportNotificationSectionHeading(unavailable), "pageviews");
    assertStringIncludes(unavailableLines.join("\n"), "incomplete source");
    assertStringIncludes(emptyLines.join("\n"), "No rows");
    assertStringIncludes(shortened.join("\n"), "more rows omitted");
    assertStringIncludes(visitorLines.join("\n"), "2 visitors");
  });

  it("formats metric edge cases and caps the SNS payload", () => {
    // Given no usable metrics and changes with zero and ratio baselines.
    const noRows = reportNotificationMetricLines(
      [
        {
          measure: "count",
          preference: "neutral",
          metric: "views",
          unit: "pageviews",
          row: { path: "/" },
          current: null,
          previous: null,
          status: "unavailable",
          reason: "metric-value-unavailable",
        },
      ],
      5,
    );
    const changes = reportNotificationMetricLines(
      [
        availableMetric(
          {},
          {
            column: "views",
            measure: "count",
            unit: "pageviews",
            preference: "higher-is-better",
          },
          2,
          0,
        ),
        availableMetric(
          { path: null },
          {
            column: "hit_percent",
            measure: "ratio",
            unit: "percent",
            preference: "higher-is-better",
          },
          96.25,
          94,
        ),
        availableMetric(
          { path: "/regression" },
          {
            column: "errors",
            measure: "count",
            unit: "errors",
            preference: "lower-is-better",
          },
          2,
          1,
        ),
        availableMetric(
          { path: "/third" },
          {
            column: "views",
            measure: "count",
            unit: "pageviews",
            preference: "neutral",
          },
          1,
          1,
        ),
      ],
      3,
    );
    const unavailable = reportNotificationMetricLines(
      [
        {
          measure: "count",
          preference: "neutral",
          metric: "views",
          unit: "pageviews",
          row: { path: "/" },
          current: 2,
          previous: null,
          status: "unavailable",
          reason: "metric-value-unavailable",
        },
      ],
      5,
    );

    // When a body also exceeds SNS's payload allowance.
    const limited = limitedReportNotificationMessage(["x".repeat(250_001)]);

    // Then every exceptional case has explicit, bounded text.
    assertStringIncludes(noRows.join("\n"), "No rows");
    assertStringIncludes(changes.join("\n"), "zero baseline");
    assertStringIncludes(changes.join("\n"), "percentage points");
    assertStringIncludes(changes.join("\n"), "regression");
    assertStringIncludes(changes.join("\n"), "more rows omitted");
    assertStringIncludes(unavailable.join("\n"), "comparison unavailable");
    assertStringIncludes(limited, "Message truncated");
  });

  it("renders date ranges and reports a missing configured question", () => {
    // Given a closed week and a digest selecting a question it does not hold.
    const week = reportPeriod(
      {
        unit: "week",
        at: new Date("2026-08-30T12:00:00.000Z"),
        timeZone: "UTC",
        weekStartsOn: "monday",
      },
      new Date("2026-08-31T00:30:00.000Z"),
    );
    const weekDocument = document(week, 10, 5);
    const manifest = reportNotificationManifest({
      closingDay: closedDay,
      periods: [closedDay],
      createdAt: new Date("2026-09-01T00:30:00.000Z"),
    });
    const entry = manifest.reports[0];
    if (entry === undefined) {
      throw new Error("The notification manifest has no report.");
    }

    // When the period heading and selected digest are rendered.
    const notification = reportNotificationMessage({
      manifest,
      bucket: "summaries-example",
      reports: [{ entry, current: document(closedDay, 10, 5) }],
      questions: ["missing"],
      maxRowsPerQuestion: 5,
      subjectPrefix: "Rainlytics",
    });

    // Then the range is inclusive and the empty selection is explicit.
    assertIdentical(
      reportNotificationHeading(weekDocument),
      "Week 2026-08-24 to 2026-08-30",
    );
    assertStringIncludes(
      notification.message,
      "No configured questions were found",
    );
  });

  it("explains a comparison whose previous section is absent", () => {
    // Given adjacent reports where the previous document has no sections.
    const previous = previousReportPeriod(closedDay);
    const manifest = reportNotificationManifest({
      closingDay: closedDay,
      periods: [closedDay],
      createdAt: new Date("2026-09-01T00:30:00.000Z"),
    });
    const entry = manifest.reports[0];
    if (entry === undefined) {
      throw new Error("The notification manifest has no report.");
    }
    const previousDocument = { ...document(previous, 8, 4), sections: [] };

    // When the digest derives its comparison.
    const notification = reportNotificationMessage({
      manifest,
      bucket: "summaries-example",
      reports: [
        {
          entry,
          current: document(closedDay, 10, 5),
          previous: previousDocument,
        },
      ],
      maxRowsPerQuestion: 5,
      subjectPrefix: "Rainlytics",
    });

    // Then current values remain and the absent section is named.
    assertStringIncludes(notification.message, "Comparison unavailable");
    assertStringIncludes(notification.message, "section absent");
  });
});
