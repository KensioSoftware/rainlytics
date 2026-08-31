import {
  assertArrayLength,
  assertIdentical,
  assertUndefined,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { reportPeriod } from "./report-periods.js";
import { reportSourceWindows } from "./report-source-windows.js";

describe("stored windows covering a calendar report", () => {
  it("uses daily summaries across a UTC month", () => {
    // Given a closed 31-day UTC month and both stored granularities.
    const period = reportPeriod(
      {
        unit: "month",
        at: new Date("2026-07-15T12:00:00.000Z"),
        timeZone: "UTC",
      },
      new Date("2026-08-01T00:00:00.000Z"),
    );

    // When its source windows are selected.
    const windows = reportSourceWindows(period, ["hourly", "daily"]) ?? [];

    // Then each UTC day is one GET.
    assertArrayLength(windows, 31);
    assertIdentical(windows[0].granularity, "daily");
  });

  it("uses hours at a time-zone edge and days through its interior", () => {
    // Given a London week whose UTC boundaries are one hour before midnight.
    const period = reportPeriod(
      {
        unit: "week",
        at: new Date("2026-08-26T12:00:00.000Z"),
        timeZone: "Europe/London",
      },
      new Date("2026-08-31T23:00:00.000Z"),
    );

    // When stored windows are selected.
    const windows = reportSourceWindows(period, ["hourly", "daily"]) ?? [];

    // Then one opening hour, six UTC days and 23 closing hours cover it.
    assertArrayLength(windows, 30);
    const last = windows.at(-1);

    if (last === undefined) {
      throw new Error(
        "The source windows unexpectedly ended before they began.",
      );
    }

    assertIdentical(windows[0].granularity, "hourly");
    assertIdentical(windows[1].granularity, "daily");
    assertIdentical(last.granularity, "hourly");
  });

  it("falls back to hourly summaries where days were not stored", () => {
    // Given a closed UTC day and an hourly-only deployment.
    const period = reportPeriod(
      {
        unit: "day",
        at: new Date("2026-08-24T12:00:00.000Z"),
        timeZone: "UTC",
      },
      new Date("2026-08-25T00:00:00.000Z"),
    );

    // Then 24 hourly source windows cover it.
    assertArrayLength(reportSourceWindows(period, ["hourly"]) ?? [], 24);
  });

  it("uses a period query when stored windows cannot meet the boundary", () => {
    // Given a Kathmandu day beginning on a quarter-hour UTC boundary.
    const period = reportPeriod(
      {
        unit: "day",
        at: new Date("2026-08-24T12:00:00.000Z"),
        timeZone: "Asia/Kathmandu",
      },
      new Date("2026-08-25T18:15:00.000Z"),
    );

    // Then neither UTC hours nor days can cover it exactly.
    assertUndefined(reportSourceWindows(period, ["hourly", "daily"]));
  });

  it("uses a period query when an edge needs a granularity not stored", () => {
    // Given a London day and daily summaries alone.
    const period = reportPeriod(
      {
        unit: "day",
        at: new Date("2026-08-24T12:00:00.000Z"),
        timeZone: "Europe/London",
      },
      new Date("2026-08-25T23:00:00.000Z"),
    );

    // Then the one-hour edges cannot be filled.
    assertUndefined(reportSourceWindows(period, ["daily"]));
  });
});
