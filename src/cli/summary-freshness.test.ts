import {
  assertIdentical,
  assertNumberBetween,
  assertObjectEquals,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import type { RollupSummary } from "../rollup-summaries.js";
import {
  count,
  getChargeInDollars,
  howLongBefore,
  newestComputedAt,
  spanOf,
} from "./summary-freshness.js";

describe("how old an answer is and what it cost to read", () => {
  /** A stored window, carrying only what these cases read. */
  const aWindow = (
    from: string,
    until: string,
    computedAt: string,
  ): RollupSummary =>
    ({
      window: { granularity: "hourly", from, until },
      computedAt,
    }) as RollupSummary;

  const ranAt = new Date("2026-08-24T09:16:00.000Z");

  it("counts a lag in minutes while it is one", () => {
    // Given a summary computed a quarter of an hour before the command ran,
    // which is the lag the shipped schedule carries.
    // Then the reader is told the number they can act on.
    assertIdentical(
      howLongBefore("2026-08-24T09:01:00.000Z", ranAt),
      "15 minutes",
    );
    assertIdentical(
      howLongBefore("2026-08-24T09:15:00.000Z", ranAt),
      "1 minute",
    );
  });

  it("counts hours once minutes stop meaning anything", () => {
    // Given a summary from earlier in the day.
    // Then hours are the unit. Six hundred minutes is a number a reader has
    // to divide before it says anything.
    assertIdentical(
      howLongBefore("2026-08-23T23:16:00.000Z", ranAt),
      "10 hours",
    );
  });

  it("counts days once hours stop meaning anything", () => {
    // Given a bucket whose schedules stopped firing a week ago.
    // Then the order of magnitude comes first.
    assertIdentical(howLongBefore("2026-08-17T09:16:00.000Z", ranAt), "7 days");
  });

  it("counts nothing where the summary is newer than the clock", () => {
    // Given a summary computed after the moment the command thinks it is,
    // which is what a machine with a drifting clock reads.
    // Then the age is zero rather than a negative number of minutes.
    assertIdentical(
      howLongBefore("2026-08-24T10:00:00.000Z", ranAt),
      "0 minutes",
    );
  });

  it("prices a read against the S3 GET rate", () => {
    // Given the 29 objects a week of pageviews covers.
    // Then the whole read is a hundredth of a cent, against the ten million
    // byte minimum Athena bills for one query.
    assertNumberBetween(
      getChargeInDollars(29),
      0.0000116 - 5 * 10 ** -10,
      0.0000116 + 5 * 10 ** -10,
    );
    assertIdentical(getChargeInDollars(0), 0);
  });

  it("takes the whole span from the windows it was given", () => {
    // Given three hours, handed over newest first.
    const summaries = [
      aWindow(
        "2026-08-24T08:00:00.000Z",
        "2026-08-24T09:00:00.000Z",
        "2026-08-24T09:15:00.000Z",
      ),
      aWindow(
        "2026-08-24T06:00:00.000Z",
        "2026-08-24T07:00:00.000Z",
        "2026-08-24T07:15:00.000Z",
      ),
      aWindow(
        "2026-08-24T07:00:00.000Z",
        "2026-08-24T08:00:00.000Z",
        "2026-08-24T08:15:00.000Z",
      ),
    ];

    // Then the span runs from the earliest to the latest, and the age is the
    // newest of them. A reader is told what the answer covers whatever order
    // it was assembled in.
    assertObjectEquals(spanOf(summaries), {
      from: "2026-08-24T06:00:00.000Z",
      until: "2026-08-24T09:00:00.000Z",
    });
    assertIdentical(newestComputedAt(summaries), "2026-08-24T09:15:00.000Z");
  });

  it("writes a count of one as one", () => {
    // Given one of a thing and then several.
    // Then the word matches. A line reading "1 windows" is a line nobody
    // proofread.
    assertIdentical(count(1, "window", "windows"), "1 window");
    assertIdentical(count(3, "window", "windows"), "3 windows");
  });
});
