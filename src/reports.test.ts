import {
  assertArrayLength,
  assertIdentical,
  assertInstanceOf,
  assertObjectEquals,
  assertObjectMatches,
  assertStringIncludes,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { reportPeriod, type ReportPeriod } from "./report-periods.js";
import {
  reportDocument,
  reportKey,
  type ReportRowsValue,
  reportSchemaVersion,
  reportSection,
} from "./reports.js";
import type { SummaryQuestion } from "./rollup-summaries.js";
import type { SummarySpan } from "./summary-windows.js";

describe("versioned report documents", () => {
  const aQuestion = (name = "pageviews"): SummaryQuestion => ({
    name,
    includeBots: false,
    limit: 20,
    param: "q",
    redirectStatuses: ["302", "303", "307"],
  });

  const rowsValue = (): ReportRowsValue => ({
    type: "rows",
    columns: ["path", "views"],
    rows: [
      {
        path: `/${faker.word.noun()}/`,
        views: String(faker.number.int({ min: 1, max: 1000 })),
      },
    ],
  });

  const utcDay = (): ReportPeriod =>
    reportPeriod(
      {
        unit: "day",
        at: new Date("2026-08-24T12:00:00.000Z"),
        timeZone: "UTC",
      },
      new Date("2026-08-25T00:00:00.000Z"),
    );

  const utcWeek = (): ReportPeriod =>
    reportPeriod(
      {
        unit: "week",
        at: new Date("2026-08-26T12:00:00.000Z"),
        timeZone: "UTC",
      },
      new Date("2026-08-31T00:00:00.000Z"),
    );

  const dailySources = (period: ReportPeriod): readonly SummarySpan[] => {
    const from = Date.parse(period.from);
    const until = Date.parse(period.until);

    return Array.from(
      { length: (until - from) / 86_400_000 },
      (_unused, index) => ({
        granularity: "daily" as const,
        from: new Date(from + index * 86_400_000).toISOString(),
        until: new Date(from + (index + 1) * 86_400_000).toISOString(),
      }),
    );
  };

  it("builds the deterministic key shared by a writer and reader", () => {
    // Given a Monday-first London week.
    const period = reportPeriod(
      {
        unit: "week",
        at: new Date("2026-08-26T12:00:00.000Z"),
        timeZone: "Europe/London",
      },
      new Date("2026-09-01T00:00:00.000Z"),
    );

    // When its report key is built.
    const key = reportKey(period);

    // Then the key names the schema, zone, week start and local opening date.
    assertIdentical(
      key,
      "reports/v1/Europe%2FLondon/week/monday/2026-08-24.json",
    );
    assertIdentical(key.split("/")[1], `v${String(reportSchemaVersion)}`);
  });

  it("leaves the week start out of another calendar unit's key", () => {
    // Given a UTC day.
    const period = utcDay();

    // When its key is built.
    const key = reportKey(period);

    // Then only facts that change the day address appear.
    assertIdentical(key, "reports/v1/UTC/day/2026-08-24.json");
  });

  it("keeps a ranked answer exact when one summary covers the period", () => {
    // Given a calendar day with its daily ranked summary.
    const period = utcDay();

    // When the report section is built.
    const section = reportSection(
      {
        question: aQuestion(),
        rule: "ranked",
        sources: dailySources(period),
        value: rowsValue(),
      },
      period,
    );

    // Then the rows are the exact ranked answer that summary computed.
    assertIdentical(section.accuracy, "exact");
    assertIdentical(section.composition, "single-summary");
  });

  it("adds count rows exactly across a complete period", () => {
    // Given a week covered by seven daily summaries of an additive question.
    const period = utcWeek();

    // When its section is built.
    const section = reportSection(
      {
        question: aQuestion("status-codes"),
        rule: "additive",
        sources: dailySources(period),
        value: rowsValue(),
      },
      period,
    );

    // Then the section records exact addition and its full source span.
    assertIdentical(section.accuracy, "exact");
    assertIdentical(section.composition, "additive");
    assertObjectEquals(section.source, {
      from: period.from,
      until: period.until,
      summaries: 7,
      complete: true,
    });
  });

  it("marks ranked rows composed from several summaries approximate", () => {
    // Given a week covered by daily top-row lists.
    const period = utcWeek();

    // When the ranked section is built.
    const section = reportSection(
      {
        question: aQuestion(),
        rule: "ranked",
        sources: dailySources(period),
        value: rowsValue(),
      },
      period,
    );

    // Then the schema cannot call the composed ranking exact.
    assertIdentical(section.accuracy, "approximate");
    assertIdentical(section.composition, "ranked-summaries");
  });

  it.each([
    ["visitor-count", "visitor-counts-do-not-compose"],
    ["percentile", "percentiles-do-not-compose"],
  ] as const)("makes a multi-summary %s unavailable", (rule, reason) => {
    // Given a week whose daily summaries hold a non-composable value.
    const period = utcWeek();
    const value =
      rule === "visitor-count"
        ? ({
            type: "visitor-count" as const,
            count: { distinct: 7, additive: false as const },
          } as const)
        : rowsValue();

    // When its section is built.
    const section = reportSection(
      {
        question: aQuestion(rule === "percentile" ? "web-vitals" : undefined),
        rule,
        sources: dailySources(period),
        value,
      },
      period,
    );

    // Then no plausible aggregate is put in the document.
    assertObjectMatches(section, {
      accuracy: "unavailable",
      composition: "none",
      reason,
      value: null,
    });
  });

  it("keeps a one-day visitor count exact", () => {
    // Given one daily visitor count over the UTC calendar day.
    const period = utcDay();

    // When its section is built.
    const section = reportSection(
      {
        question: aQuestion(),
        rule: "visitor-count",
        sources: dailySources(period),
        value: {
          type: "visitor-count",
          count: { distinct: 42, additive: false },
        },
      },
      period,
    );

    // Then it records the one source that gives the count meaning.
    assertIdentical(section.accuracy, "exact");
    assertIdentical(section.composition, "single-summary");
  });

  it("represents a missing optional rollup in the sections array", () => {
    // Given a report period with no stored Web Vitals rollup.
    const period = utcDay();

    // When its expected section is built.
    const section = reportSection(
      { question: aQuestion("web-vitals"), rule: "missing" },
      period,
    );

    // Then absence is a value in the schema, not an omitted array entry.
    assertObjectEquals(section, {
      question: aQuestion("web-vitals"),
      accuracy: "unavailable",
      composition: "none",
      reason: "missing-rollup",
      source: null,
      value: null,
    });
  });

  it("refuses to present a source gap as an answer", () => {
    // Given a week missing its Wednesday summary.
    const period = utcWeek();
    const sources = dailySources(period).filter(
      (source) => !source.from.startsWith("2026-08-26"),
    );

    // When an additive section is built from what remains.
    const section = reportSection(
      {
        question: aQuestion("status-codes"),
        rule: "additive",
        sources,
        value: rowsValue(),
      },
      period,
    );

    // Then it records the incomplete span and withholds the rows.
    assertObjectMatches(section, {
      accuracy: "unavailable",
      reason: "incomplete-source",
      source: { summaries: 6, complete: false },
      value: null,
    });
  });

  it("marks an empty source set unavailable", () => {
    // Given an expected additive section with no stored summaries.
    const period = utcDay();

    // When the section is built from the empty source set.
    const section = reportSection(
      {
        question: aQuestion("status-codes"),
        rule: "additive",
        sources: [],
        value: rowsValue(),
      },
      period,
    );

    // Then its source records zero summaries and no answer is exposed.
    assertObjectMatches(section, {
      accuracy: "unavailable",
      reason: "incomplete-source",
      source: {
        from: period.from,
        until: period.from,
        summaries: 0,
        complete: false,
      },
      value: null,
    });
  });

  it.each([
    ["not an instant", "2026-08-25T00:00:00.000Z", "source start"],
    ["2026-08-24T00:00:00Z", "2026-08-25T00:00:00.000Z", "source start"],
    ["2026-08-24T00:00:00.000Z", "tomorrow", "source end"],
  ])("refuses a noncanonical summary %s", (from, until, message) => {
    // Given a source with an invalid or noncanonical UTC instant.
    const period = utcDay();

    // When the section is built.
    const building = (): unknown =>
      reportSection(
        {
          question: aQuestion(),
          rule: "ranked",
          sources: [{ granularity: "daily", from, until }],
          value: rowsValue(),
        },
        period,
      );

    // Then malformed source metadata cannot enter the report document.
    {
      const error = assertThrowsError(building);
      assertStringIncludes(error.message, message);
    }
  });

  it("refuses a summary source that does not move forwards", () => {
    // Given a source whose end is the same instant as its start.
    const period = utcDay();
    const instant = "2026-08-24T00:00:00.000Z";

    // When the section is built.
    const building = (): unknown =>
      reportSection(
        {
          question: aQuestion(),
          rule: "ranked",
          sources: [
            {
              granularity: "daily",
              from: instant,
              until: instant,
            },
          ],
          value: rowsValue(),
        },
        period,
      );

    // Then the invalid span is refused.
    {
      const error = assertThrowsError(building);
      assertStringMatches(error.message, /must end after it starts/u);
    }
  });

  it("writes the versioned JSON envelope and source coverage", () => {
    // Given exact pageview rows and an optional section that was not stored.
    const period = utcWeek();
    const pageviews = reportSection(
      {
        question: aQuestion(),
        rule: "additive",
        sources: dailySources(period),
        value: rowsValue(),
      },
      period,
    );
    const vitals = reportSection(
      { question: aQuestion("web-vitals"), rule: "missing" },
      period,
    );

    // When the document makes the same JSON round trip as an S3 object.
    const written = reportDocument({
      period,
      computedAt: new Date("2026-08-31T00:15:00.000Z"),
      sections: [pageviews, vitals],
    });
    // This deliberately exercises the JSON document boundary.
    // oxlint-disable-next-line unicorn/prefer-structured-clone
    const read = JSON.parse(JSON.stringify(written)) as typeof written;

    // Then it keeps its version, period, coverage, computation and sections.
    assertObjectEquals(read, written);
    assertIdentical(read.schemaVersion, reportSchemaVersion);
    assertObjectEquals(read.sourceCoverage, {
      from: period.from,
      until: period.until,
      complete: true,
    });
    assertIdentical(read.computedAt, "2026-08-31T00:15:00.000Z");
    assertArrayLength(read.sections, 2);
  });

  it("uses null coverage when every expected rollup is missing", () => {
    // Given a report containing only a missing optional question.
    const period = utcDay();
    const missing = reportSection(
      { question: aQuestion("web-vitals"), rule: "missing" },
      period,
    );

    // When its document is built.
    const document = reportDocument({
      period,
      computedAt: new Date(period.until),
      sections: [missing],
    });

    // Then the document states that no source coverage exists.
    assertIdentical(document.sourceCoverage, null);
  });

  it("takes document coverage from several partial section sources", () => {
    // Given three incomplete sections, supplied in neither time nor span order.
    const period = utcWeek();
    const parts = [
      ["2026-08-27T00:00:00.000Z", "2026-08-29T00:00:00.000Z"],
      ["2026-08-25T00:00:00.000Z", "2026-08-26T00:00:00.000Z"],
      ["2026-08-28T00:00:00.000Z", "2026-08-30T00:00:00.000Z"],
    ] as const;
    const sections = parts.map(([from, until], index) =>
      reportSection(
        {
          question: aQuestion(`partial-${String(index)}`),
          rule: "additive",
          sources: [{ granularity: "daily", from, until }],
          value: rowsValue(),
        },
        period,
      ),
    );

    // When the document derives its source coverage.
    const document = reportDocument({
      period,
      computedAt: new Date(period.until),
      sections,
    });

    // Then it records the outer span and does not call partial input complete.
    assertObjectEquals(document.sourceCoverage, {
      from: "2026-08-25T00:00:00.000Z",
      until: "2026-08-30T00:00:00.000Z",
      complete: false,
    });
  });

  it("refuses a document computed before its period closed", () => {
    // Given a closed period and a claimed computation inside it.
    const period = utcDay();

    // When the document is built.
    const building = (): unknown =>
      reportDocument({
        period,
        computedAt: new Date("2026-08-24T23:59:59.999Z"),
        sections: [],
      });

    // Then the timestamp cannot make a closed report out of an open period.
    {
      const error = assertThrowsError(building);
      assertStringMatches(error.message, /cannot be computed before/u);
    }
  });

  it("refuses an invalid document computation time", () => {
    // Given a closed period and a computation time with no instant.
    const period = utcDay();

    // When the document is built.
    const building = (): unknown =>
      reportDocument({
        period,
        computedAt: new Date("not a date"),
        sections: [],
      });

    // Then invalid timestamp text cannot enter the JSON document.
    {
      const error = assertThrowsError(building);
      assertStringMatches(error.message, /invalid Date/u);
    }
  });

  it("refuses a value that disagrees with its composition rule", () => {
    // Given rows labelled as a visitor count.
    const period = utcDay();

    // When the section is built.
    const building = (): unknown =>
      reportSection(
        {
          question: aQuestion(),
          rule: "visitor-count",
          sources: dailySources(period),
          value: rowsValue(),
        },
        period,
      );

    // Then the mismatch is refused before it reaches JSON.
    assertInstanceOf(assertThrowsError(building), TypeError);
  });
});
