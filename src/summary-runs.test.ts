import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { windowPlaceholder } from "./rollup-rows.js";
import {
  defaultRecomputedWindows,
  recomputedWindows,
  windowedSql,
  windowRange,
} from "./summary-runs.js";
import type { SummaryGranularity } from "./summary-windows.js";
import { summaryGranularities } from "./summary-windows.js";

describe("the windows one run computes", () => {
  const aGranularity = (): SummaryGranularity =>
    faker.helpers.arrayElement(summaryGranularities);

  it("leaves out the window the run is happening in", () => {
    // Given a run a quarter of an hour into an hour.
    const now = new Date("2026-08-23T09:15:00.000Z");

    // When it asks which hours to compute.
    const windows = recomputedWindows(now, "hourly", 1);

    // Then it gets the hour before, which has closed. The hour holding the
    // run is still filling, and a summary of it would report a quiet hour
    // that nobody could tell from a real one.
    expect(windows.map((window) => window.at.toISOString())).toStrictEqual([
      "2026-08-23T08:59:59.999Z",
    ]);
  });

  it("walks back from the newest closed window", () => {
    // Given a run on the daily cadence, computing three days.
    const now = new Date("2026-08-23T00:15:00.000Z");

    // When it asks which days to compute.
    const windows = recomputedWindows(now, "daily", 3);

    // Then they are the three days before this one, newest first.
    expect(
      windows.map((window) => windowRange(window).from.toISOString()),
    ).toStrictEqual([
      "2026-08-22T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z",
    ]);
  });

  it("computes the same windows whether or not the run was punctual", () => {
    // Given two runs in one hour, one on time and one late.
    const punctual = new Date("2026-08-23T09:15:00.000Z");
    const late = new Date("2026-08-23T09:52:41.000Z");

    // When each asks which hours to compute.
    const asked = [punctual, late].map((now) =>
      recomputedWindows(now, "hourly").map((window) =>
        windowRange(window).from.toISOString(),
      ),
    );

    // Then both get the same hours. The lag lives in the schedule, and a run
    // that started late computes what a punctual one would have.
    expect(asked[0]).toStrictEqual(asked[1]);
    expect(asked[0]).toHaveLength(defaultRecomputedWindows);
  });

  it("refuses to compute no windows at all", () => {
    // Given a run told to compute nothing.
    const computing = (): unknown =>
      recomputedWindows(faker.date.recent(), aGranularity(), 0);

    // Then it says so, rather than reporting a successful run that wrote
    // nothing.
    expect(computing).toThrow(RangeError);
  });

  it("refuses a count that is not a whole number of windows", () => {
    // Given a run told to compute two and a half windows.
    const computing = (): unknown =>
      recomputedWindows(faker.date.recent(), aGranularity(), 2.5);

    // Then it says so.
    expect(computing).toThrow(RangeError);
  });
});

describe("the span a window reads", () => {
  it("stops a millisecond short of the next window", () => {
    // Given the hour beginning at nine.
    const window = {
      granularity: "hourly",
      at: new Date("2026-08-23T09:41:12.345Z"),
    } as const;

    // When the range it reads is worked out.
    const range = windowRange(window);

    // Then it holds every instant in the hour and none of the next one. A
    // rollup's range includes both its ends, and a record stamped exactly on
    // the boundary belongs to the window it opens and to no other.
    expect(range.from.toISOString()).toBe("2026-08-23T09:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-08-23T09:59:59.999Z");
  });
});

describe("filling a window into a scheduled query", () => {
  it("puts the partitions and the span where the placeholder was", () => {
    // Given a query built for a window nobody had reached yet.
    const template = `SELECT count(*)\n  WHERE ${windowPlaceholder}\n    AND cs_method = 'GET'\n`;

    // When it is filled in for one hour.
    const sql = windowedSql(template, {
      granularity: "hourly",
      at: new Date("2026-08-23T09:41:12.345Z"),
    });

    // Then the query names the partitions it reads and the exact span inside
    // them, and the rest of it is untouched.
    expect(sql).toContain("year IN ('2026')");
    expect(sql).toContain("month IN ('08')");
    expect(sql).toContain("day IN ('23')");
    const nineOClock = Date.UTC(2026, 7, 23, 9);

    expect(sql).toContain(
      `cast(timestamp_ms AS bigint) BETWEEN ${String(nineOClock)}` +
        ` AND ${String(nineOClock + 3_599_999)}`,
    );
  });

  it("leaves the rest of the query alone", () => {
    // Given a query with a condition of its own after the placeholder.
    const template = `SELECT count(*)\n  WHERE ${windowPlaceholder}\n    AND cs_method = 'GET'\n`;

    // When it is filled in.
    const sql = windowedSql(template, {
      granularity: "daily",
      at: faker.date.recent(),
    });

    // Then the question it asks is the one that was written, and nothing is
    // left for Athena to choke on.
    expect(sql).toContain("AND cs_method = 'GET'");
    expect(sql).not.toContain(windowPlaceholder);
  });

  it("refuses a query that says nothing about which window it reads", () => {
    // Given a query somebody wrote without the partition predicate.
    const filling = (): unknown =>
      windowedSql(`SELECT count(*) FROM logs\n`, {
        granularity: "hourly",
        at: faker.date.recent(),
      });

    // Then it is refused before it can be sent. Athena would take it and read
    // every partition the table projects, which is the one failure in this
    // pipeline that costs money quietly.
    expect(filling).toThrow(/window/iu);
  });
});
