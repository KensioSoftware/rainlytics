import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { hivePartitionPrefix } from "./index.js";

describe("hive partition prefixes", () => {
  it("pads every component to the width partition projection expects", () => {
    // Given an instant in the first hours of a single-digit day and month,
    // where each component is shorter than its partition format.
    const instant = new Date(Date.UTC(2026, 0, 5, 4, 30));

    // When the partition prefix covering it is built.
    const prefix = hivePartitionPrefix(instant);

    // Then each component carries the leading zero projection matches on.
    expect(prefix).toBe("year=2026/month=01/day=05/hour=04");
  });

  it("names the UTC components of the instant it covers", () => {
    // Given any instant in the range a log dataset plausibly spans.
    const instant = faker.date.between({
      from: "2020-01-01T00:00:00Z",
      to: "2035-01-01T00:00:00Z",
    });

    // When the partition prefix covering it is built.
    const prefix = hivePartitionPrefix(instant);

    // Then it reads back as the same four components ISO 8601 gives, which is
    // a different route to them than the one under test.
    const iso = instant.toISOString();
    expect(prefix).toBe(
      [
        `year=${iso.slice(0, 4)}`,
        `month=${iso.slice(5, 7)}`,
        `day=${iso.slice(8, 10)}`,
        `hour=${iso.slice(11, 13)}`,
      ].join("/"),
    );
  });

  it("refuses an invalid Date rather than partitioning under NaN", () => {
    // Given a Date that parsed from something that was never a date.
    const instant = new Date(faker.lorem.word());

    // When a partition prefix is asked for.
    const partitioning = (): string => hivePartitionPrefix(instant);

    // Then it fails here, and not as a `year=NaN` prefix on S3 that every
    // later query silently misses.
    expect(partitioning).toThrow(RangeError);
  });
});
