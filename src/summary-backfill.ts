// Which windows a backfill computes, and what one invocation of it answers.
//
// Apart from `summary-runs.ts` because a scheduled run takes its windows from
// the clock and a backfill takes them from a range somebody named. The job and
// the command line both read this module. The job computes the windows and the
// command line counts them before it starts, and the two have to agree on which
// windows a range holds.
//
// Nothing here reaches for the AWS SDK. It is dates.

import type { SummaryGranularity, SummaryWindow } from "./summary-windows.js";
import { summarySpan } from "./summary-windows.js";

/**
 * The span a backfill was asked to cover.
 *
 * `from` is inside it and `until` is outside it, the same convention a
 * summary's own span follows.
 */
export interface BackfillRange {
  /** An instant inside the oldest window to compute. */
  readonly from: Date;

  /** The first instant after the range. */
  readonly until: Date;
}

/**
 * What one invocation of a backfill answers with.
 *
 * A Lambda invocation stops at fifteen minutes, and a month of hourly windows
 * does not fit in one. So an invocation computes what fits in its own time
 * and hands back the payload that carries on from there. The command line
 * invokes again with `next` until there is none, and so can anybody invoking
 * the function by hand.
 */
export interface BackfillProgress {
  /** The first instant of each window this invocation wrote, oldest first. */
  readonly computed: readonly string[];

  /**
   * The payload that computes the rest of the range, where some remains.
   *
   * The payload this invocation was given with its range moved on, so a
   * caller sends it back unchanged.
   */
  readonly next?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * The windows a range holds, oldest first.
 *
 * Every window that overlaps the range and has closed by `now`. A window the
 * range starts part-way through is included, since its summary is the only
 * place the start of the range is counted. A window still filling is left
 * out for the reason `recomputedWindows` gives, and the scheduled run
 * computes it once it closes.
 */
export function backfillWindows(
  range: BackfillRange,
  granularity: SummaryGranularity,
  now: Date,
): readonly SummaryWindow[] {
  const closedBy = Date.parse(summarySpan({ granularity, at: now }).from);
  const windows: SummaryWindow[] = [];
  let at = Date.parse(summarySpan({ granularity, at: range.from }).from);

  while (at < range.until.getTime()) {
    const until = Date.parse(
      summarySpan({ granularity, at: new Date(at) }).until,
    );

    if (until > closedBy) {
      break;
    }

    windows.push({ granularity, at: new Date(at) });
    at = until;
  }

  return windows;
}
