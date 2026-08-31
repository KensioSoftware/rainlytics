import {
  assertIdentical,
  assertInstanceOf,
  assertThrowsError,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import {
  type SummaryGranularity,
  summaryGranularities,
  summarySpan,
} from "./summary-windows.js";

describe("the window a rollup summary covers", () => {
  /** How long each window is, written out here and not read from the code. */
  const lengthOf: Readonly<Record<SummaryGranularity, number>> = {
    hourly: 3_600_000,
    daily: 86_400_000,
  };

  /** The first instant of some window, addressed in UTC. */
  const aWindowStart = (granularity: SummaryGranularity): number =>
    Date.UTC(
      2026,
      faker.number.int({ min: 0, max: 11 }),
      faker.number.int({ min: 1, max: 28 }),
      granularity === "hourly" ? faker.number.int({ min: 0, max: 23 }) : 0,
    );

  it.each(summaryGranularities)(
    "covers the span the key names and no more (%s)",
    (granularity) => {
      // Given any instant.
      const start = aWindowStart(granularity);
      const at = new Date(
        start + faker.number.int({ min: 0, max: lengthOf[granularity] - 1 }),
      );

      // When the window holding it is described.
      const span = summarySpan({ granularity, at });

      // Then it opens at the window's own start and runs one window on. An
      // hour of traffic reported over 61 minutes is a number nothing else
      // agrees with.
      assertIdentical(span.from, new Date(start).toISOString());
      assertIdentical(
        span.until,
        new Date(start + lengthOf[granularity]).toISOString(),
      );
      assertIdentical(span.granularity, granularity);
    },
  );

  it.each(summaryGranularities)(
    "ends one window where the next one starts (%s)",
    (granularity) => {
      // Given the last instant of a window and the first of the one after it.
      const granularityLength = lengthOf[granularity];
      const start = aWindowStart(granularity);
      const last = new Date(start + granularityLength - 1);
      const next = new Date(start + granularityLength);

      // Then the first span runs up to where the second begins. Midnight
      // belongs to the day it opens, and a reader adding two windows together
      // counts no instant twice and misses none between them.
      assertIdentical(
        summarySpan({ granularity, at: last }).until,
        summarySpan({ granularity, at: next }).from,
      );
    },
  );

  it("refuses a window addressed by an invalid Date", () => {
    // Given an instant that parsed into nothing.
    const describing = (): unknown =>
      summarySpan({ granularity: "hourly", at: new Date(faker.word.noun()) });

    // Then it says so, rather than a span reading "Invalid Date" that every
    // later comparison quietly fails.
    assertInstanceOf(assertThrowsError(describing), RangeError);
  });
});
