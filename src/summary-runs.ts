// Which windows one run of the scheduled job computes, and the SQL each of
// them runs.
//
// Apart from `summary-windows.ts` because that module addresses a window and
// this one chooses which windows to address. The construct reads it to write
// a schedule and the handler reads it to answer one, and a schedule that
// fired for a window the handler never computes would leave a gap nobody
// sees.
//
// Nothing here reaches for the AWS SDK. It is dates and text.

import { partitionPredicate, windowPlaceholder } from "./rollup-rows.js";
import type { SummaryGranularity, SummaryWindow } from "./summary-windows.js";
import { summarySpan } from "./summary-windows.js";
import type { TimeRange } from "./time-range.js";

/**
 * How many windows one run recomputes, where nobody chooses otherwise.
 *
 * Two, being the window that has just closed and the one before it. One would
 * compute each window once and never again, and a record delivered after its
 * window was computed would stay invisible for as long as the summary lived.
 * CloudFront delivery was measured at p50 169s and a maximum of 373s across
 * 200,074 records in KensioSoftware/rainlytics#9, so an hour's partition is
 * complete by four minutes past the next hour. The second window is an extra
 * hour of grace on top of the lag the schedule already carries.
 *
 * The cost is one Athena query per extra window per question per run. Athena
 * bills a ten million byte minimum whatever a query reads, so a question on
 * both cadences goes from about four cents a month to about eight.
 *
 * A site that has watched its own delivery and wants the cheaper answer sets
 * this to 1. A site whose logs arrive from several distributions, or whose
 * traffic is bursty enough to push delivery past the lag, raises it.
 */
export const defaultRecomputedWindows = 2;

/**
 * The windows a run computes, newest first.
 *
 * Every one of them has closed. The window `now` falls inside is still
 * filling, and a summary of a part-finished hour would report a quiet hour
 * that nobody could tell from a real one. So the newest window here is the
 * one before it.
 *
 * Worked out from `now` alone. The lag lives in the schedule expression,
 * where it decides when a run happens, and a run that starts late still
 * computes the same windows a punctual one would.
 *
 * @throws {RangeError} for a count below one, which would compute nothing and
 *   report success.
 */
export function recomputedWindows(
  now: Date,
  granularity: SummaryGranularity,
  count: number = defaultRecomputedWindows,
): readonly SummaryWindow[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(
      `A run computes a whole number of windows, at least one. Got ${String(count)}.`,
    );
  }

  const windows: SummaryWindow[] = [];
  let at = now;

  for (let taken = 0; taken < count; taken += 1) {
    // A millisecond before this window opens is the last instant of the one
    // before it, and `summarySpan` truncates whatever instant it is given.
    at = new Date(Date.parse(summarySpan({ granularity, at }).from) - 1);
    windows.push({ granularity, at });
  }

  return windows;
}

/**
 * The span a window covers, as a rollup asks for a range.
 *
 * A window runs up to its end and stops short of it, and a rollup's range
 * includes both of its ends. So the range ends a millisecond inside the
 * window. A record stamped exactly on the boundary belongs to the window it
 * opens and to no other, and a range that included both ends would count it
 * in two consecutive summaries.
 */
export function windowRange(window: SummaryWindow): TimeRange {
  const span = summarySpan(window);

  return {
    from: new Date(span.from),
    to: new Date(Date.parse(span.until) - 1),
  };
}

/**
 * One question's SQL, with the window it is being asked about filled in.
 *
 * The template comes from `rollupSql` under the {@link summarisedWindow}
 * range, which writes {@link windowPlaceholder} where the partition predicate
 * goes. Filling it in here produces the same text a `rainlytics` command
 * would send for the same span, from the same builder.
 *
 * @throws {Error} for a template carrying no placeholder. Athena would take
 *   such a query and read every partition the table projects, which is the
 *   one failure in this pipeline that costs money quietly.
 */
export function windowedSql(template: string, window: SummaryWindow): string {
  if (!template.includes(windowPlaceholder)) {
    throw new Error(
      `A scheduled query has to say which window it reads, and this one` +
        ` carries no ${windowPlaceholder}. Build it with rollupSql under the` +
        ` summarisedWindow range.`,
    );
  }

  return template.replaceAll(
    windowPlaceholder,
    partitionPredicate(windowRange(window)),
  );
}
