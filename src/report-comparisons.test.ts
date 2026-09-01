import {
  assertArrayLength,
  assertIdentical,
  assertObjectMatches,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import type { ReportDocument } from "./report-document.js";
import type { ReportPeriod, ReportPeriodUnit } from "./report-periods.js";
import { reportPeriod } from "./report-periods.js";
import type {
  ReportComparisonDefinition,
  ReportMetricComparison,
} from "./report-comparison-types.js";
import {
  previousReportPeriod,
  reportComparison,
} from "./report-comparisons.js";
import type {
  ReportSection,
  ReportSectionSource,
} from "./report-section-types.js";
import type { SummaryQuestion, SummaryRow } from "./rollup-summaries.js";

describe("calendar report comparisons", () => {
  const question = (
    name: string,
    over: Partial<SummaryQuestion> = {},
  ): SummaryQuestion => ({
    name,
    includeBots: false,
    limit: 20,
    param: "q",
    redirectStatuses: ["302", "303", "307"],
    ...over,
  });

  const period = (
    unit: ReportPeriodUnit,
    at: string,
    timeZone = "UTC",
    weekStartsOn = "monday" as const,
  ): ReportPeriod => {
    const request = { unit, at: new Date(at), timeZone, weekStartsOn };

    return unit === "week"
      ? reportPeriod({ ...request, unit }, new Date("2028-01-01T00:00:00Z"))
      : reportPeriod({ ...request, unit }, new Date("2028-01-01T00:00:00Z"));
  };

  const source = (
    forPeriod: ReportPeriod,
    complete = true,
  ): ReportSectionSource => ({
    from: forPeriod.from,
    until: complete ? forPeriod.until : forPeriod.from,
    summaries: 1,
    complete,
  });

  const rowsSection = (
    forPeriod: ReportPeriod,
    named: string,
    columns: readonly string[],
    rows: readonly SummaryRow[],
    accuracy: "exact" | "approximate" = "exact",
    asked: SummaryQuestion = question(named),
    complete = true,
  ): ReportSection =>
    accuracy === "approximate"
      ? {
          question: asked,
          accuracy,
          composition: "ranked-summaries",
          source: source(forPeriod, complete),
          value: { type: "rows", columns, rows },
        }
      : {
          question: asked,
          accuracy,
          composition: "period-query",
          source: source(forPeriod, complete),
          value: { type: "rows", columns, rows },
        };

  const visitorSection = (
    forPeriod: ReportPeriod,
    distinct: number,
  ): ReportSection => ({
    question: question("pageviews"),
    accuracy: "exact",
    composition: "period-query",
    source: source(forPeriod),
    value: {
      type: "visitor-count",
      count: { distinct, additive: false },
    },
  });

  const unavailableSection = (): ReportSection => ({
    question: question("web-vitals"),
    accuracy: "unavailable",
    composition: "none",
    reason: "missing-rollup",
    // oxlint-disable-next-line unicorn/no-null
    source: null,
    // oxlint-disable-next-line unicorn/no-null
    value: null,
  });

  const document = (
    forPeriod: ReportPeriod,
    sections: readonly ReportSection[],
  ): ReportDocument => ({
    schemaVersion: 1,
    period: forPeriod,
    sourceCoverage: {
      from: forPeriod.from,
      until: forPeriod.until,
      complete: true,
    },
    computedAt: new Date(Date.parse(forPeriod.until) + 1_800_000).toISOString(),
    sections,
  });

  const metric = (
    comparison: ReturnType<typeof reportComparison>,
    section: number,
    at: number,
  ): ReportMetricComparison => {
    const found = comparison.sections[section];

    if (found?.status !== "available") {
      throw new Error(`Comparison section ${String(section)} is unavailable.`);
    }

    const compared = found.metrics[at];
    if (compared === undefined) {
      throw new Error(`Comparison metric ${String(at)} is absent.`);
    }

    return compared;
  };

  it.each([
    ["day", "2026-03-01T12:00:00Z", "2026-02-28"],
    ["week", "2026-03-18T12:00:00Z", "2026-03-09"],
    ["month", "2024-03-15T12:00:00Z", "2024-02-01"],
    ["year", "2025-06-01T12:00:00Z", "2024-01-01"],
  ] as const)(
    "finds the preceding calendar %s across its boundary",
    (unit, at, expectedStart) => {
      // Given a closed calendar period.
      const current = period(unit, at);

      // When its comparison period is selected.
      const previous = previousReportPeriod(current);

      // Then the same calendar unit ends where the current one begins.
      assertIdentical(previous.unit, unit);
      assertIdentical(previous.startsOn, expectedStart);
      assertIdentical(previous.until, current.from);
    },
  );

  it("uses the 23-hour and 25-hour days in a daylight-saving calendar", () => {
    // Given the London days immediately after both clock changes.
    const afterSpring = period("day", "2026-03-30T12:00:00Z", "Europe/London");
    const afterAutumn = period("day", "2026-10-26T12:00:00Z", "Europe/London");

    // When each preceding day is selected.
    const springChange = previousReportPeriod(afterSpring);
    const autumnChange = previousReportPeriod(afterAutumn);

    // Then local midnights give the correct unequal UTC durations.
    assertIdentical(
      Date.parse(springChange.until) - Date.parse(springChange.from),
      23 * 3_600_000,
    );
    assertIdentical(
      Date.parse(autumnChange.until) - Date.parse(autumnChange.from),
      25 * 3_600_000,
    );
  });

  it("compares pageviews and visitors as relative percentages", () => {
    // Given adjacent reports with one page and a visitor count each.
    const currentPeriod = period("day", "2026-08-24T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const current = document(currentPeriod, [
      rowsSection(
        currentPeriod,
        "pageviews",
        ["path", "views"],
        [{ path: "/", views: "150" }],
      ),
      visitorSection(currentPeriod, 0),
    ]);
    const previous = document(previousPeriod, [
      rowsSection(
        previousPeriod,
        "pageviews",
        ["path", "views"],
        [{ path: "/", views: "100" }],
      ),
      visitorSection(previousPeriod, 0),
    ]);

    // When the stored documents are compared.
    const compared = reportComparison({ current, previous });

    // Then the count change is relative and a zero baseline stays finite.
    assertObjectMatches(metric(compared, 0, 0), {
      status: "available",
      unit: "pageviews",
      current: 150,
      previous: 100,
      difference: 50,
      change: { type: "relative-percent", value: 50 },
      trend: "increase",
      assessment: "unrated",
    });
    assertObjectMatches(metric(compared, 1, 0), {
      status: "available",
      unit: "visitors",
      current: 0,
      previous: 0,
      change: {
        type: "relative-percent",
        value: null,
        reason: "zero-baseline",
      },
      trend: "unchanged",
    });
  });

  it("uses percentage points for a ratio", () => {
    // Given cache ratios for adjacent days.
    const currentPeriod = period("day", "2026-08-24T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const columns = ["hits", "misses", "hit_percent"];
    const current = document(currentPeriod, [
      rowsSection(currentPeriod, "cache-hit-ratio", columns, [
        { hits: "80", misses: "20", hit_percent: "80" },
      ]),
    ]);
    const previous = document(previousPeriod, [
      rowsSection(previousPeriod, "cache-hit-ratio", columns, [
        { hits: "70", misses: "30", hit_percent: "70" },
      ]),
    ]);

    // When they are compared.
    const compared = reportComparison({ current, previous });

    // Then the ratio has a percentage-point change and a preferred direction.
    assertObjectMatches(metric(compared, 0, 2), {
      status: "available",
      measure: "ratio",
      unit: "percent",
      preference: "higher-is-better",
      difference: 10,
      change: { type: "percentage-points", value: 10 },
      assessment: "improvement",
    });
  });

  it("gives percentiles units and treats a lower value as an improvement", () => {
    // Given adjacent Web Vitals percentiles.
    const currentPeriod = period("month", "2026-08-15T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const columns = ["vital", "p75", "samples"];
    const current = document(currentPeriod, [
      rowsSection(currentPeriod, "web-vitals", columns, [
        { vital: "lcp", p75: "2000", samples: "40" },
        { vital: "cls", p75: "0.1", samples: "40" },
        { vital: "custom", p75: "3", samples: "4" },
        { vital: null, p75: "3", samples: "4" },
      ]),
    ]);
    const previous = document(previousPeriod, [
      rowsSection(previousPeriod, "web-vitals", columns, [
        { vital: "lcp", p75: "2500", samples: "30" },
        { vital: "cls", p75: "0.2", samples: "30" },
        { vital: "custom", p75: "2", samples: "3" },
        { vital: null, p75: "2", samples: "3" },
      ]),
    ]);

    // When the percentile rows are compared.
    const compared = reportComparison({ current, previous });

    // Then duration and unitless percentiles retain their units and direction.
    assertObjectMatches(metric(compared, 0, 0), {
      status: "available",
      row: { vital: "lcp" },
      measure: "percentile",
      unit: "milliseconds",
      difference: -500,
      change: { type: "relative-percent", value: -20 },
      preference: "lower-is-better",
      assessment: "improvement",
    });
    assertObjectMatches(metric(compared, 0, 2), {
      status: "available",
      row: { vital: "cls" },
      unit: "score",
      assessment: "improvement",
    });
    assertObjectMatches(metric(compared, 0, 4), {
      status: "available",
      row: { vital: "custom" },
      unit: "value",
      assessment: "regression",
    });
    assertObjectMatches(metric(compared, 0, 6), {
      status: "available",
      row: { vital: null },
      unit: "value",
      assessment: "regression",
    });
  });

  it("supports a caller-defined numeric duration", () => {
    // Given a custom report question with duration comparison metadata.
    const currentPeriod = period("day", "2026-08-24T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const definitions: readonly ReportComparisonDefinition[] = [
      {
        question: "render-time",
        valueType: "rows",
        rowSet: "complete",
        metrics: [
          {
            column: "milliseconds",
            measure: "duration",
            unit: "milliseconds",
            preference: "lower-is-better",
          },
        ],
      },
    ];
    const current = document(currentPeriod, [
      rowsSection(
        currentPeriod,
        "render-time",
        ["route", "milliseconds"],
        [{ route: "/", milliseconds: "75" }],
      ),
    ]);
    const previous = document(previousPeriod, [
      rowsSection(
        previousPeriod,
        "render-time",
        ["route", "milliseconds"],
        [{ route: "/", milliseconds: "100" }],
      ),
    ]);

    // When the custom definition is used.
    const compared = reportComparison({ current, previous, definitions });

    // Then its unit, relative change and lower preference are explicit.
    assertObjectMatches(metric(compared, 0, 0), {
      status: "available",
      measure: "duration",
      unit: "milliseconds",
      change: { type: "relative-percent", value: -25 },
      assessment: "improvement",
    });
  });

  it("withholds a differently configured question", () => {
    // Given the same question name narrowed to different paths.
    const currentPeriod = period("day", "2026-08-24T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const currentQuestion = question("pageviews", { paths: ["/docs/"] });
    const previousQuestion = question("pageviews", { paths: ["/blog/"] });
    const current = document(currentPeriod, [
      rowsSection(
        currentPeriod,
        "pageviews",
        ["path", "views"],
        [{ path: "/docs/", views: "5" }],
        "exact",
        currentQuestion,
      ),
    ]);
    const previous = document(previousPeriod, [
      rowsSection(
        previousPeriod,
        "pageviews",
        ["path", "views"],
        [{ path: "/blog/", views: "5" }],
        "exact",
        previousQuestion,
      ),
    ]);

    // When the documents are compared.
    const [compared] = reportComparison({ current, previous }).sections;

    // Then both source questions remain visible and no values are compared.
    assertObjectMatches(compared, {
      status: "unavailable",
      reason: "question-mismatch",
      questions: {
        current: { paths: ["/docs/"] },
        previous: { paths: ["/blog/"] },
      },
    });
  });

  it("does not turn an absent ranked row into zero", () => {
    // Given two approximate top-N answers with only one row in common.
    const currentPeriod = period("week", "2026-08-26T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const current = document(currentPeriod, [
      rowsSection(
        currentPeriod,
        "pageviews",
        ["path", "views"],
        [
          { path: "/both/", views: "20" },
          { path: "/current/", views: "10" },
        ],
        "approximate",
      ),
    ]);
    const previous = document(previousPeriod, [
      rowsSection(
        previousPeriod,
        "pageviews",
        ["path", "views"],
        [
          { path: "/both/", views: "15" },
          { path: "/previous/", views: "8" },
        ],
      ),
    ]);

    // When unlike row keys are compared.
    const compared = reportComparison({ current, previous });
    const section = compared.sections[0];

    // Then approximation carries through and unmatched rows stay unavailable.
    assertObjectMatches(section, {
      status: "available",
      accuracy: "approximate",
    });
    assertArrayLength(section.metrics, 3);
    assertObjectMatches(metric(compared, 0, 1), {
      status: "unavailable",
      reason: "ranked-row-absent",
      row: { path: "/current/" },
      current: 10,
      previous: null,
    });
    assertObjectMatches(metric(compared, 0, 2), {
      status: "unavailable",
      reason: "ranked-row-absent",
      row: { path: "/previous/" },
      current: null,
      previous: 8,
    });
  });

  it("withholds missing metric values and incomplete sections", () => {
    // Given one null baseline, one incomplete section and one unavailable one.
    const currentPeriod = period("day", "2026-08-24T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const columns = ["hits", "misses", "hit_percent"];
    const current = document(currentPeriod, [
      rowsSection(currentPeriod, "cache-hit-ratio", columns, [
        { hits: "0", misses: "0", hit_percent: null },
      ]),
      rowsSection(
        currentPeriod,
        "pageviews",
        ["path", "views"],
        [{ path: "/", views: "2" }],
        "exact",
        question("pageviews"),
        false,
      ),
      unavailableSection(),
    ]);
    const previous = document(previousPeriod, [
      rowsSection(previousPeriod, "cache-hit-ratio", columns, [
        { hits: "0", misses: "0", hit_percent: null },
      ]),
      rowsSection(
        previousPeriod,
        "pageviews",
        ["path", "views"],
        [{ path: "/", views: "1" }],
      ),
      unavailableSection(),
    ]);

    // When all three section pairs are considered.
    const compared = reportComparison({ current, previous });

    // Then no absent, incomplete or unavailable value enters arithmetic.
    assertObjectMatches(metric(compared, 0, 2), {
      status: "unavailable",
      reason: "metric-value-unavailable",
      current: null,
      previous: null,
    });
    assertIdentical(compared.sections[1]?.status, "unavailable");
    assertObjectMatches(compared.sections[1], {
      reason: "incomplete-source",
    });
    assertObjectMatches(compared.sections[2], {
      status: "unavailable",
      reason: "section-unavailable",
    });
  });

  it("withholds section pairs without comparable structure", () => {
    // Given absent, differently typed, unsupported and malformed sections.
    const currentPeriod = period("day", "2026-08-24T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const definitions: readonly ReportComparisonDefinition[] = [
      {
        question: "render-time",
        valueType: "rows",
        rowSet: "complete",
        metrics: [
          {
            column: "milliseconds",
            measure: "duration",
            unit: "milliseconds",
            preference: "lower-is-better",
          },
        ],
      },
    ];
    const current = document(currentPeriod, [
      rowsSection(currentPeriod, "current-only", ["count"], [{ count: "1" }]),
      rowsSection(
        currentPeriod,
        "different-value",
        ["count"],
        [{ count: "1" }],
      ),
      rowsSection(currentPeriod, "unknown", ["count"], [{ count: "1" }]),
      rowsSection(
        currentPeriod,
        "cache-hit-ratio",
        ["hits", "misses", "hit_percent"],
        [{ hits: "1", misses: "1", hit_percent: "50" }],
      ),
      rowsSection(currentPeriod, "render-time", ["route"], [{ route: "/" }]),
    ]);
    const previousVisitor = {
      ...visitorSection(previousPeriod, 1),
      question: question("different-value"),
    };
    const previous = document(previousPeriod, [
      previousVisitor,
      rowsSection(previousPeriod, "unknown", ["count"], [{ count: "1" }]),
      rowsSection(previousPeriod, "cache-hit-ratio", ["hits"], [{ hits: "1" }]),
      rowsSection(previousPeriod, "render-time", ["route"], [{ route: "/" }]),
      rowsSection(previousPeriod, "previous-only", ["count"], [{ count: "1" }]),
    ]);

    // When the documents are compared.
    const compared = reportComparison({ current, previous, definitions });

    // Then every unsafe pair is withheld with its precise reason.
    assertArrayLength(compared.sections, 6);
    assertObjectMatches(compared.sections[0], {
      status: "unavailable",
      reason: "section-absent",
      previous: null,
    });
    assertObjectMatches(compared.sections[1], {
      status: "unavailable",
      reason: "value-type-mismatch",
    });
    assertObjectMatches(compared.sections[2], {
      status: "unavailable",
      reason: "unsupported-question",
    });
    assertObjectMatches(compared.sections[3], {
      status: "unavailable",
      reason: "columns-mismatch",
    });
    assertObjectMatches(compared.sections[4], {
      status: "unavailable",
      reason: "columns-mismatch",
    });
    assertObjectMatches(compared.sections[5], {
      status: "unavailable",
      reason: "section-absent",
      current: null,
    });
  });

  it("refuses a report outside the immediately preceding calendar period", () => {
    // Given a current report and another report from two days earlier.
    const currentPeriod = period("day", "2026-08-24T12:00:00Z");
    const previousPeriod = previousReportPeriod(
      previousReportPeriod(currentPeriod),
    );
    const current = document(currentPeriod, []);
    const previous = document(previousPeriod, []);

    // When the documents are compared.
    const comparing = () => reportComparison({ current, previous });

    // Then the differing dates and UTC boundaries explain their gap.
    const error = assertThrowsError(comparing);
    assertStringMatches(
      error.message,
      /startsOn expected "2026-08-23" but got "2026-08-22"/u,
    );
    assertStringMatches(
      error.message,
      /from expected "2026-08-23T00:00:00.000Z" but got "2026-08-22T00:00:00.000Z"/u,
    );
    assertStringMatches(
      error.message,
      /until expected "2026-08-24T00:00:00.000Z" but got "2026-08-23T00:00:00.000Z"/u,
    );
  });

  it("names a mismatched report calendar", () => {
    // Given a preceding weekly report with a different calendar configuration.
    const currentPeriod = period("week", "2026-08-26T12:00:00Z");
    const expectedPrevious = previousReportPeriod(currentPeriod);
    if (expectedPrevious.unit !== "week") {
      throw new Error("Expected a weekly report period.");
    }
    const previousPeriod: ReportPeriod = {
      ...expectedPrevious,
      timeZone: "Europe/London",
      weekStartsOn: "sunday",
    };
    const current = document(currentPeriod, []);
    const previous = document(previousPeriod, []);

    // When the documents are compared.
    const comparing = () => reportComparison({ current, previous });

    // Then the time zone and first weekday values identify the mismatch.
    const error = assertThrowsError(comparing);
    assertStringMatches(
      error.message,
      /timeZone expected "UTC" but got "Europe\/London"/u,
    );
    assertStringMatches(
      error.message,
      /weekStartsOn expected "monday" but got "sunday"/u,
    );
  });

  it("refuses a visitor definition without a metric", () => {
    // Given adjacent visitor reports and a metricless caller definition.
    const currentPeriod = period("day", "2026-08-24T12:00:00Z");
    const previousPeriod = previousReportPeriod(currentPeriod);
    const current = document(currentPeriod, [visitorSection(currentPeriod, 2)]);
    const previous = document(previousPeriod, [
      visitorSection(previousPeriod, 1),
    ]);
    const definitions: readonly ReportComparisonDefinition[] = [
      {
        question: "pageviews",
        valueType: "visitor-count",
        rowSet: "complete",
        metrics: [],
      },
    ];

    // When the metricless definition is used, then it is rejected explicitly.
    const error = assertThrowsError(() =>
      reportComparison({ current, previous, definitions }),
    );
    assertStringMatches(error.message, /defines no metric/u);
  });
});
