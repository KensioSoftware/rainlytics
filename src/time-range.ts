// The span of time a question covers, and the partitions holding it.
//
// A range has to become partition predicates rather than a filter on the
// record's own timestamp. `WHERE timestamp_ms > ...` answers correctly and
// reads every object ever delivered to do it, which is the mistake the whole
// partition layout exists to prevent.

import {
  defaultPartitionGranularity,
  type PartitionGranularity,
  timeKeysFor,
} from "./partition-keys.js";

/** A span of time, from an instant up to another. */
export interface TimeRange {
  /** The earliest instant in the span. */
  readonly from: Date;

  /** The instant the span runs up to. */
  readonly to: Date;
}

/** How long `--last` was given as, being a number and a unit. */
const lastPattern = /^(?<count>\d+)(?<unit>[hdw])$/u;

const unitHours: Readonly<Record<string, number>> = { h: 1, d: 24, w: 168 };

/**
 * The range `--last 7d` names, ending now.
 *
 * Hours, days and weeks. Anything longer is a number of days, since a month
 * is not a fixed length and a range that quietly meant 30 days would be worse
 * than one nobody could ask for.
 *
 * @throws {RangeError} for a span this cannot read.
 */
export function lastRange(text: string, now: Date): TimeRange {
  const found = lastPattern.exec(text.trim());
  const count = Number(found?.groups?.["count"]);
  const hours = unitHours[found?.groups?.["unit"] ?? ""];

  if (hours === undefined || !Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(
      `"${text}" is not a span this reads. Give a whole number of hours,` +
        ` days or weeks, as in 24h, 7d or 2w.`,
    );
  }

  return { from: new Date(now.getTime() - count * hours * 3_600_000), to: now };
}

/** One partition key and the values a range touches, coarsest first. */
export interface PartitionValues {
  /** The key, as the table declares it. */
  readonly name: string;

  /** Every value that key takes across the range, in order. */
  readonly values: readonly string[];
}

/**
 * The values each time partition key takes across a range.
 *
 * Walked a day at a time and collected per key, so the answer is bounded by
 * the number of distinct values a key has rather than by the length of the
 * range. A decade asks for ten years, twelve months and thirty-one days.
 *
 * Reading them per key rather than as whole tuples costs something. The
 * predicate they build is a cross product, so a range from the 28th of August
 * to the 3rd of September asks for seven days in two months and reads
 * fourteen partitions. Whatever reads them narrows the rows afterwards, and
 * fourteen partitions against a year of them is still the difference the
 * layout exists to make.
 *
 * @throws {RangeError} for a range that ends before it starts, which would
 *   otherwise come back as a key taking no values at all and build a
 *   predicate reading `IN ()`.
 */
export function partitionValuesCovering(
  range: TimeRange,
  granularity: PartitionGranularity = defaultPartitionGranularity,
): readonly PartitionValues[] {
  if (range.to.getTime() < range.from.getTime()) {
    throw new RangeError(
      `A range cannot end before it starts. Got ${range.from.toISOString()}` +
        ` to ${range.to.toISOString()}.`,
    );
  }

  // The day, whatever the granularity. An hourly table holds four keys and
  // this pins three of them, which is as fine as a cross product can go
  // without asking for every hour of every day in the range.
  const keys = timeKeysFor(granularity).filter((key) => key.name !== "hour");
  const found = keys.map(() => new Set<string>());

  for (const at of daysFrom(range)) {
    for (const [index, key] of keys.entries()) {
      found[index]?.add(key.valueAt(at));
    }
  }

  return keys.map((key, index) => ({
    name: key.name,
    values: [...(found[index] ?? [])],
  }));
}

/** Every day a range touches, including the ones at either end. */
function daysFrom(range: TimeRange): readonly Date[] {
  const days: Date[] = [];
  const cursor = new Date(
    Date.UTC(
      range.from.getUTCFullYear(),
      range.from.getUTCMonth(),
      range.from.getUTCDate(),
    ),
  );

  while (cursor.getTime() <= range.to.getTime()) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}
