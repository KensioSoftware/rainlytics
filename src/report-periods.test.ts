import {
  assertIdentical,
  assertInstanceOf,
  assertObjectEquals,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import {
  defaultReportWeekStartsOn,
  reportPeriod,
  reportPeriodUnits,
} from "./report-periods.js";

describe("calendar report periods", () => {
  it("defines the four closed calendar units", () => {
    // Given the public list of report periods.
    // When a caller reads it.
    // Then it names every calendar unit from shortest to longest.
    assertObjectEquals(reportPeriodUnits, ["day", "week", "month", "year"]);
  });

  it("uses a local day that loses an hour to daylight saving", () => {
    // Given an instant in the day London moves its clocks forward.
    const at = new Date("2026-03-29T12:00:00.000Z");

    // When that calendar day is built after it has closed.
    const period = reportPeriod(
      { unit: "day", at, timeZone: "Europe/London" },
      new Date("2026-03-30T00:00:00.000Z"),
    );

    // Then its local midnights are 23 hours apart.
    assertObjectEquals(period, {
      unit: "day",
      timeZone: "Europe/London",
      startsOn: "2026-03-29",
      endsBefore: "2026-03-30",
      from: "2026-03-29T00:00:00.000Z",
      until: "2026-03-29T23:00:00.000Z",
    });
  });

  it("uses a local day that gains an hour from daylight saving", () => {
    // Given an instant in the day London moves its clocks back.
    const at = new Date("2026-10-25T12:00:00.000Z");

    // When that calendar day is built after it has closed.
    const period = reportPeriod(
      { unit: "day", at, timeZone: "Europe/London" },
      new Date("2026-10-26T01:00:00.000Z"),
    );

    // Then its local midnights are 25 hours apart.
    assertIdentical(period.from, "2026-10-24T23:00:00.000Z");
    assertIdentical(period.until, "2026-10-26T00:00:00.000Z");
  });

  it("starts weeks on Monday by default", () => {
    // Given a Wednesday in a London summer week.
    const at = new Date("2026-08-26T12:00:00.000Z");

    // When its week is built without another first weekday.
    const period = reportPeriod(
      { unit: "week", at, timeZone: "Europe/London" },
      new Date("2026-09-01T00:00:00.000Z"),
    );

    // Then the week runs from Monday to Monday in that calendar.
    assertIdentical(period.weekStartsOn, defaultReportWeekStartsOn);
    assertIdentical(period.startsOn, "2026-08-24");
    assertIdentical(period.endsBefore, "2026-08-31");
    assertIdentical(period.from, "2026-08-23T23:00:00.000Z");
    assertIdentical(period.until, "2026-08-30T23:00:00.000Z");
  });

  it("honours a Sunday week start", () => {
    // Given the same Wednesday under a Sunday-first calendar.
    const at = new Date("2026-08-26T12:00:00.000Z");

    // When its week is built.
    const period = reportPeriod(
      {
        unit: "week",
        at,
        timeZone: "Europe/London",
        weekStartsOn: "sunday",
      },
      new Date("2026-08-31T00:00:00.000Z"),
    );

    // Then the period records the choice and uses Sunday boundaries.
    assertIdentical(period.weekStartsOn, "sunday");
    assertIdentical(period.startsOn, "2026-08-23");
    assertIdentical(period.endsBefore, "2026-08-30");
  });

  it("keeps the leap day inside its calendar month", () => {
    // Given an instant in February of a leap year.
    const at = new Date("2024-02-14T12:00:00.000Z");

    // When its UTC calendar month is built.
    const period = reportPeriod(
      { unit: "month", at, timeZone: "UTC" },
      new Date("2024-03-01T00:00:00.000Z"),
    );

    // Then March starts after all 29 February days.
    assertIdentical(period.startsOn, "2024-02-01");
    assertIdentical(period.endsBefore, "2024-03-01");
    assertIdentical(
      Date.parse(period.until) - Date.parse(period.from),
      29 * 86_400_000,
    );
  });

  it("uses calendar-year boundaries in the named zone", () => {
    // Given an instant in a Tokyo calendar year.
    const at = new Date("2025-06-01T00:00:00.000Z");

    // When the year is built after it has closed.
    const period = reportPeriod(
      { unit: "year", at, timeZone: "Asia/Tokyo" },
      new Date("2026-01-01T00:00:00.000Z"),
    );

    // Then both boundaries are Tokyo midnight, nine hours ahead of UTC.
    assertIdentical(period.from, "2024-12-31T15:00:00.000Z");
    assertIdentical(period.until, "2025-12-31T15:00:00.000Z");
  });

  it("accepts a period at the instant it closes", () => {
    // Given yesterday and the midnight that ended it.
    const midnight = new Date("2026-08-31T00:00:00.000Z");

    // When yesterday is built at that instant.
    const period = reportPeriod(
      {
        unit: "day",
        at: new Date("2026-08-30T12:00:00.000Z"),
        timeZone: "UTC",
      },
      midnight,
    );

    // Then the day is closed and available to a report writer.
    assertIdentical(period.until, midnight.toISOString());
  });

  it("refuses the unfinished current period", () => {
    // Given a clock still inside the day being addressed.
    const now = new Date("2026-08-31T12:00:00.000Z");

    // When that day is built.
    const building = (): unknown =>
      reportPeriod({ unit: "day", at: now, timeZone: "UTC" }, now);

    // Then it names the closing instant still ahead.
    {
      const error = assertThrowsError(building);
      assertStringMatches(
        error.message,
        /has not closed.*2026-09-01T00:00:00.000Z/u,
      );
    }
  });

  it("refuses invalid dates and time zones", () => {
    // Given an invalid address, clock and IANA time zone.
    const invalid = new Date("not a date");

    // When each is used to build a period.
    const badAddress = (): unknown =>
      reportPeriod({ unit: "day", at: invalid, timeZone: "UTC" });
    const badClock = (): unknown =>
      reportPeriod(
        {
          unit: "day",
          at: new Date("2026-08-30T12:00:00.000Z"),
          timeZone: "UTC",
        },
        invalid,
      );
    const badZone = (): unknown =>
      reportPeriod({
        unit: "day",
        at: new Date("2026-08-30T12:00:00.000Z"),
        timeZone: "Somewhere/Else",
      });

    // Then each failure is reported before a document can carry it.
    assertInstanceOf(assertThrowsError(badAddress), RangeError);
    assertInstanceOf(assertThrowsError(badClock), RangeError);
    {
      const error = assertThrowsError(badZone);
      assertStringMatches(error.message, /Somewhere\/Else/u);
    }
  });
});
