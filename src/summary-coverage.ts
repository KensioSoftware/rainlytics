// Which stored windows lie inside a span somebody asked about.
//
// Apart from `summary-runs.ts` because the two pick windows for opposite
// halves of the pipeline. A run picks the windows it is about to compute, and
// this picks the windows a reader wants back. A reader's span arrives from
// `--last 7d` and lands wherever the clock happens to be, and the windows on
// S3 sit on UTC hour and day boundaries.
//
// Nothing here reaches for the AWS SDK. It is dates.

import type {
  SummaryGranularity,
  SummarySpan,
  SummaryWindow,
} from "./summary-windows.js";
import { summarySpan } from "./summary-windows.js";
import type { TimeRange } from "./time-range.js";

/** How long each window is, in milliseconds. */
const windowMilliseconds: Readonly<Record<SummaryGranularity, number>> = {
  hourly: 3_600_000,
  daily: 86_400_000,
};

/**
 * The stored windows a range covers, oldest first.
 *
 * Whole windows, and every one of them inside the range at both ends. A range
 * running from 15:37 on one day to 14:37 on another covers the hours from
 * 16:00 to 14:00 and misses two part hours at the edges. Those two are
 * questions about a partly finished hour, and no stored window answers one.
 *
 * Days where a whole UTC day fits and hours either side of them. A week comes
 * to at most 23 hours, six days and 23 hours again, so 52 objects at the
 * worst and 29 on a range starting mid-afternoon. Hours all the way through
 * would be 167.
 *
 * A day here is a stored daily summary computed from raw, and never the sum of
 * the 24 hourly ones under it. `docs/summaries/` has the three things that
 * break when summaries are added up, and the ranking is the one that bites.
 *
 * @throws {RangeError} for an invalid Date, before a loop over NaN reports an
 *   empty coverage that reads like a range nobody has computed.
 */
export function summaryCoverage(range: TimeRange): readonly SummaryWindow[] {
  const from = openingHourAfter(range.from);
  const until = openingHourAt(range.to);
  const windows: SummaryWindow[] = [];

  for (let at = from; at < until;) {
    const granularity = wholeDayFits(at, until) ? "daily" : "hourly";

    windows.push({ granularity, at: new Date(at) });
    at += windowMilliseconds[granularity];
  }

  return windows;
}

/**
 * The whole span a list of windows runs across, in ISO 8601 and UTC.
 *
 * Folded over the list rather than read off its two ends, so a list in any
 * order answers the same. A list holding nothing answers with two empty
 * strings, which is what a caller that skipped its own check gets.
 */
export function coveredSpan(windows: readonly SummaryWindow[]): SummarySpan {
  let from = "";
  let until = "";
  let granularity: SummaryGranularity = "hourly";

  for (const window of windows) {
    const span = summarySpan(window);

    from = from === "" ? span.from : from;
    until = span.until;
    granularity = span.granularity;
  }

  return { granularity, from, until };
}

/**
 * The 24 hourly windows one daily window holds, oldest first.
 *
 * A day is stored as its own query over raw, and a reader meeting a day
 * nobody computed can still assemble one from its hours. That is the second
 * reason hourly windows exist, and `docs/summaries/` has what the assembly
 * costs a ranked answer.
 *
 * @throws {RangeError} for an invalid Date, through `summarySpan`.
 */
export function hoursIn(window: SummaryWindow): readonly SummaryWindow[] {
  const opened = Date.parse(
    summarySpan({ ...window, granularity: "daily" }).from,
  );

  return Array.from({ length: 24 }, (_unused, hour) => ({
    granularity: "hourly" as const,
    at: new Date(opened + hour * windowMilliseconds.hourly),
  }));
}

/** Whether the day opening at an instant ends on or before the last one. */
function wholeDayFits(at: number, until: number): boolean {
  return at % windowMilliseconds.daily === 0 && at + 86_400_000 <= until;
}

/** The first whole hour at or after an instant, in milliseconds. */
function openingHourAfter(at: Date): number {
  const opened = openingHourAt(at);

  return opened === at.getTime() ? opened : opened + windowMilliseconds.hourly;
}

/** The instant the hour holding a moment opened, in milliseconds. */
function openingHourAt(at: Date): number {
  return Date.parse(summarySpan({ granularity: "hourly", at }).from);
}
