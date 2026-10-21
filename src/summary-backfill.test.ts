import {
  assertArrayEmpty,
  assertArrayLength,
  assertObjectEquals,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { backfillWindows } from "./summary-backfill.js";
import type { SummaryWindow } from "./summary-windows.js";

describe("the windows a backfill computes", () => {
  const startsOf = (windows: readonly SummaryWindow[]): readonly string[] =>
    windows.map((window) => window.at.toISOString());

  it("names every window of the range, oldest first", () => {
    // Given a range of three whole hours, long since closed.
    const range = {
      from: new Date("2026-09-11T00:00:00.000Z"),
      until: new Date("2026-09-11T03:00:00.000Z"),
    };

    // When the hourly windows of it are asked for.
    const windows = backfillWindows(
      range,
      "hourly",
      new Date("2026-10-21T12:00:00.000Z"),
    );

    // Then they are the three hours, and the hour `until` opens is not one
    // of them.
    assertObjectEquals(startsOf(windows), [
      "2026-09-11T00:00:00.000Z",
      "2026-09-11T01:00:00.000Z",
      "2026-09-11T02:00:00.000Z",
    ]);
  });

  it("includes the windows the range starts and ends part-way through", () => {
    // Given a range from twenty past one hour to ten past another.
    const range = {
      from: new Date("2026-09-11T00:20:00.000Z"),
      until: new Date("2026-09-11T02:10:00.000Z"),
    };

    // When the hourly windows of it are asked for.
    const windows = backfillWindows(
      range,
      "hourly",
      new Date("2026-10-21T12:00:00.000Z"),
    );

    // Then both ragged hours are computed whole. A summary covers a whole
    // window or none, and leaving them out would leave the ends of the
    // range uncounted.
    assertObjectEquals(startsOf(windows), [
      "2026-09-11T00:00:00.000Z",
      "2026-09-11T01:00:00.000Z",
      "2026-09-11T02:00:00.000Z",
    ]);
  });

  it("stops at the last window that has closed", () => {
    // Given a range running past now.
    const range = {
      from: new Date("2026-10-19T00:00:00.000Z"),
      until: new Date("2026-10-30T00:00:00.000Z"),
    };

    // When the daily windows of it are asked for at noon on the 21st.
    const windows = backfillWindows(
      range,
      "daily",
      new Date("2026-10-21T12:00:00.000Z"),
    );

    // Then the 21st is left out. It is still filling, and the schedule
    // computes it once it closes.
    assertObjectEquals(startsOf(windows), [
      "2026-10-19T00:00:00.000Z",
      "2026-10-20T00:00:00.000Z",
    ]);
  });

  it("names nothing for a range that has not closed", () => {
    // Given a range inside the current hour.
    const range = {
      from: new Date("2026-10-21T12:05:00.000Z"),
      until: new Date("2026-10-21T12:30:00.000Z"),
    };

    // When its hourly windows are asked for.
    const windows = backfillWindows(
      range,
      "hourly",
      new Date("2026-10-21T12:40:00.000Z"),
    );

    // Then there are none.
    assertArrayEmpty(windows);
  });

  it("covers a month of hours from the day the logs began", () => {
    // Given the range poprobincards.co.uk lost to a missing salt.
    const range = {
      from: new Date("2026-09-11T00:00:00.000Z"),
      until: new Date("2026-10-12T00:00:00.000Z"),
    };

    // When its hourly windows are asked for.
    const windows = backfillWindows(
      range,
      "hourly",
      new Date("2026-10-21T12:00:00.000Z"),
    );

    // Then there is one for each of the 31 days' hours.
    assertArrayLength(windows, 31 * 24);
  });
});
