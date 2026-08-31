import {
  assertArrayLength,
  assertIdentical,
  assertInstanceOf,
  assertObjectEquals,
  assertThrowsError,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { hoursIn, summaryCoverage } from "./summary-coverage.js";
import { summarySpan } from "./summary-windows.js";

describe("the stored windows a range covers", () => {
  /** The spans of a coverage, which is what a reader can check by eye. */
  const spans = (
    from: string,
    to: string,
  ): readonly { granularity: string; from: string }[] =>
    summaryCoverage({ from: new Date(from), to: new Date(to) }).map(
      (window) => {
        const span = summarySpan(window);

        return { granularity: span.granularity, from: span.from };
      },
    );

  it("covers the whole hours inside a span that starts mid-hour", () => {
    // Given a span of four hours and a bit, starting at 37 minutes past.
    const covered = spans(
      "2026-08-23T09:37:00.000Z",
      "2026-08-23T13:37:00.000Z",
    );

    // Then the three whole hours between are covered and the two part hours
    // at the edges are left out. A question about a partly finished hour has
    // no stored window to answer it.
    assertObjectEquals(covered, [
      { granularity: "hourly", from: "2026-08-23T10:00:00.000Z" },
      { granularity: "hourly", from: "2026-08-23T11:00:00.000Z" },
      { granularity: "hourly", from: "2026-08-23T12:00:00.000Z" },
    ]);
  });

  it("takes a whole day as one window", () => {
    // Given a span running from an evening to the following morning, with a
    // whole UTC day inside it.
    const covered = spans(
      "2026-08-22T22:00:00.000Z",
      "2026-08-24T02:00:00.000Z",
    );

    // Then the day between is one object and the edges are hours. Reading
    // the day as 24 hourly objects would cost 24 GETs for the same answer,
    // and the stored day was counted from raw in one query.
    assertObjectEquals(covered, [
      { granularity: "hourly", from: "2026-08-22T22:00:00.000Z" },
      { granularity: "hourly", from: "2026-08-22T23:00:00.000Z" },
      { granularity: "daily", from: "2026-08-23T00:00:00.000Z" },
      { granularity: "hourly", from: "2026-08-24T00:00:00.000Z" },
      { granularity: "hourly", from: "2026-08-24T01:00:00.000Z" },
    ]);
  });

  it("holds a week to 52 objects at the worst", () => {
    // Given a week ending at the least convenient moment, being one minute
    // past an hour at both ends.
    const covered = spans(
      "2026-08-16T09:01:00.000Z",
      "2026-08-23T09:01:00.000Z",
    );

    // Then it is 14 hours, six days and nine hours. Hours all the way
    // through would be 167 GETs for the same week.
    assertArrayLength(covered, 29);
    assertArrayLength(
      covered.filter((window) => window.granularity === "daily"),
      6,
    );
  });

  it("covers nothing where the span falls inside one hour", () => {
    // Given the hour that is running now, asked about before it has closed.
    const covered = spans(
      "2026-08-23T09:20:00.000Z",
      "2026-08-23T09:50:00.000Z",
    );

    // Then there is nothing to read. Whatever asks reports that rather than
    // answering over a window nobody wrote.
    assertObjectEquals(covered, []);
  });

  it("refuses a span it cannot read", () => {
    // Given a date that is not one.
    const asked = { from: new Date("never"), to: new Date() };

    // Then it says so, rather than answering with an empty coverage that
    // reads exactly like a range nobody has computed.
    assertInstanceOf(
      assertThrowsError(() => summaryCoverage(asked)),
      RangeError,
    );
  });

  it("names the 24 hours of the day holding an instant", () => {
    // Given a day, addressed by a moment in the middle of it.
    const hours = hoursIn({
      granularity: "daily",
      at: new Date("2026-08-23T14:37:00.000Z"),
    });

    // Then every hour of that UTC day comes back, oldest first. A day
    // nobody computed is assembled from these.
    const opened = hours.map((hour) => summarySpan(hour).from);

    assertArrayLength(opened, 24);
    assertIdentical(opened.at(0), "2026-08-23T00:00:00.000Z");
    assertIdentical(opened.at(-1), "2026-08-23T23:00:00.000Z");
  });
});
