import {
  assertArrayLength,
  assertInstanceOf,
  assertObjectEquals,
  assertThrowsError,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { closingReportPeriods } from "./report-periods.js";

describe("calendar periods closing before a report run", () => {
  it("includes every unit that closes at a year boundary", () => {
    // Given the first half hour of Monday 1 January in UTC. The prior day
    // closed a Monday-first week, a month and a year together.
    const now = new Date("2024-01-01T00:30:00.000Z");

    // When periods closing in the latest local day are selected.
    const periods = closingReportPeriods(now, "UTC", "monday", 1);

    // Then the day, week, month and year all appear, shortest first.
    assertObjectEquals(
      periods.map((period) => [period.unit, period.startsOn]),
      [
        ["day", "2023-12-31"],
        ["week", "2023-12-25"],
        ["month", "2023-12-01"],
        ["year", "2023-01-01"],
      ],
    );
  });

  it("walks local dates across a short daylight-saving day", () => {
    // Given the first report run after the UK spring clock change.
    const now = new Date("2026-03-29T23:30:00.000Z");

    // When two recently closed London days are selected.
    const periods = closingReportPeriods(now, "Europe/London", "monday", 2);

    // Then both local dates appear despite the newest one lasting 23 hours.
    assertObjectEquals(
      periods
        .filter((period) => period.unit === "day")
        .map((period) => period.startsOn),
      ["2026-03-29", "2026-03-28"],
    );
    assertArrayLength(periods, 3);
  });

  it("refuses a run that would recompute no closing day", () => {
    // Given an invalid count of closing days.
    // Then it is refused before any period is built.
    assertInstanceOf(
      assertThrowsError(() =>
        closingReportPeriods(new Date(), "UTC", "monday", 0),
      ),
      RangeError,
    );
  });
});
