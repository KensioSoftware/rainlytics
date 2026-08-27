import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { lastRange, partitionValuesCovering } from "./time-range.js";

describe("the span a question covers", () => {
  const at = new Date("2026-08-27T13:00:00.000Z");

  it.each([
    ["24h", "2026-08-26T13:00:00.000Z"],
    ["7d", "2026-08-20T13:00:00.000Z"],
    ["2w", "2026-08-13T13:00:00.000Z"],
  ])("reads %s as a span ending now", (asked, from) => {
    // Given a span in hours, days or weeks.
    const range = lastRange(asked, at);

    // Then it runs back from now by that much.
    expect(range.from.toISOString()).toBe(from);
    expect(range.to).toStrictEqual(at);
  });

  it.each([
    ["a month, which is not a fixed length", "1m"],
    ["a fraction", "1.5d"],
    ["nothing at all", ""],
    ["no unit", "7"],
    ["a span of nothing", "0d"],
    ["words", "a fortnight"],
  ])("refuses %s", (_what, asked) => {
    // Given something that is not a span this reads.
    const reading = (): unknown => lastRange(asked, at);

    // Then it says what it takes, rather than guessing at a range somebody
    // would be billed for.
    expect(reading).toThrow(RangeError);
    expect(reading).toThrow(/24h, 7d or 2w/u);
  });
});

describe("the partitions a span touches", () => {
  const covering = (from: string, to: string) =>
    Object.fromEntries(
      partitionValuesCovering({
        from: new Date(from),
        to: new Date(to),
      }).map((key) => [key.name, key.values]),
    );

  it("names the day at each end and every one between", () => {
    // Given a span of three days inside one month.
    const values = covering("2026-08-21T10:00:00Z", "2026-08-23T09:00:00Z");

    // Then every day it touches is named, including the partial ones at
    // either end. A range starting at ten in the morning still needs the
    // whole of that day's partition read.
    expect(values).toStrictEqual({
      year: ["2026"],
      month: ["08"],
      day: ["21", "22", "23"],
    });
  });

  it("names the hour partition for no span at all", () => {
    // Given the hourly layout, whose fourth key this deliberately leaves
    // alone.
    const values = covering("2026-08-21T10:00:00Z", "2026-08-21T11:00:00Z");

    // Then the hour is absent. Pinning it as well would mean a cross product
    // over every hour of every day in the range, which asks for partitions
    // that hold nothing in every combination but one.
    expect(values["hour"]).toBeUndefined();
  });

  it("crosses a month and a year without losing a day", () => {
    // Given a span running from December into January.
    const values = covering("2026-12-30T00:00:00Z", "2027-01-02T00:00:00Z");

    // Then both years and both months are named, along with the four days.
    expect(values).toStrictEqual({
      year: ["2026", "2027"],
      month: ["12", "01"],
      day: ["30", "31", "01", "02"],
    });
  });

  it("stays bounded however long the span is", () => {
    // Given a decade.
    const values = covering("2016-01-01T00:00:00Z", "2026-01-01T00:00:00Z");

    // Then the predicate it builds is bounded by the values a key can take
    // rather than by the length of the span. Eleven years, twelve months and
    // thirty-one days describes 3,654 days.
    expect(values["year"]).toHaveLength(11);
    expect(values["month"]).toHaveLength(12);
    expect(values["day"]).toHaveLength(31);
  });

  it("pads every value the way the writer padded it", () => {
    // Given a span in a single-digit month, on a single-digit day.
    const values = covering("2026-01-05T00:00:00Z", "2026-01-05T23:00:00Z");

    // Then the values carry the leading zeros the S3 keys carry. Athena
    // matches a projected value against the key character for character.
    expect(values).toStrictEqual({
      year: ["2026"],
      month: ["01"],
      day: ["05"],
    });
  });

  it("covers whatever instant it is handed", () => {
    // Given any instant in the range a log dataset plausibly spans.
    const instant = faker.date.between({
      from: "2026-01-01T00:00:00Z",
      to: "2030-01-01T00:00:00Z",
    });
    const values = covering(instant.toISOString(), instant.toISOString());

    // Then the day holding it is named, by the same components ISO 8601
    // gives, which is a different route to them than the one under test.
    const iso = instant.toISOString();
    expect(values).toStrictEqual({
      year: [iso.slice(0, 4)],
      month: [iso.slice(5, 7)],
      day: [iso.slice(8, 10)],
    });
  });
});
