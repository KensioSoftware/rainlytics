// A backfill, computed for as long as one invocation has time to.
//
// A month of hourly windows is about 745 questions and as many visitor
// counts, one at a time for the reason `computeWindow` gives. That is longer
// than any one Lambda invocation may run. So an invocation works through the
// windows oldest first, stops while it still has time to finish the window it
// is on, and answers with the payload that carries on from the next one.
//
// The caller invokes again, rather than the function invoking itself. A
// function invoking itself needs permission to, and an asynchronous
// invocation that fails is retried twice by Lambda with nobody watching. A
// caller holding the loop sees every invocation's answer and every failure.

import type { BackfillProgress, BackfillRange } from "../summary-backfill.js";
import { backfillWindows } from "../summary-backfill.js";
import type { SummaryGranularity, SummaryWindow } from "../summary-windows.js";
import { summarySpan } from "../summary-windows.js";

/**
 * The part of the Lambda context a backfill reads.
 *
 * Only the time left. A caller with no context, such as a test calling the
 * handler directly, gets every window computed in one go.
 */
export interface InvocationTime {
  readonly getRemainingTimeInMillis: () => number;
}

/**
 * The least time an invocation keeps in hand before starting a window.
 *
 * Half a minute, which is several times what one window's two queries and
 * one write take on a quiet workgroup. Twice the slowest window so far is
 * kept instead where that is longer, so a workgroup that has slowed down is
 * met by an invocation that stops earlier.
 */
export const backfillReserveMilliseconds = 30_000;

/** What a backfill needs from the job that runs it. */
export interface BackfillJob {
  /** The payload the invocation was given, which `next` is built from. */
  readonly payload: unknown;

  /** The range it names. */
  readonly range: BackfillRange;

  /** How long the windows are. */
  readonly granularity: SummaryGranularity;

  /** Computes and writes one window, as the scheduled run does. */
  readonly compute: (window: SummaryWindow) => Promise<void>;
}

/**
 * Computes the windows of a range until they run out or the time does.
 *
 * At least one window every invocation, whatever time is left, so a caller
 * repeating `next` always gets nearer the end of the range.
 */
export async function backfill(
  job: BackfillJob,
  time: InvocationTime | undefined,
): Promise<BackfillProgress> {
  const windows = backfillWindows(job.range, job.granularity, new Date());
  const computed: string[] = [];
  let slowest = 0;

  for (const window of windows) {
    if (
      computed.length > 0 &&
      time !== undefined &&
      time.getRemainingTimeInMillis() <
        Math.max(backfillReserveMilliseconds, 2 * slowest)
    ) {
      return { computed, next: carryingOn(job, window) };
    }

    const started = Date.now();

    // One at a time, which `computeWindow` explains.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await job.compute(window);
    slowest = Math.max(slowest, Date.now() - started);
    computed.push(summarySpan(window).from);
  }

  return { computed };
}

/** The payload that computes the range from `window` onwards. */
function carryingOn(
  job: BackfillJob,
  window: SummaryWindow,
): Readonly<Record<string, unknown>> {
  return {
    ...(job.payload as Readonly<Record<string, unknown>>),
    backfill: {
      from: summarySpan(window).from,
      until: job.range.until.toISOString(),
    },
  };
}
