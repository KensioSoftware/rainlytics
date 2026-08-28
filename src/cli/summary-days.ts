// Every window of a range, and whatever was found under its key.
//
// Apart from `summary-covering.ts` because fetching and judging are two jobs.
// This puts a summary against each window it can, and that module decides what
// the windows still holding nothing mean.
//
// A day nobody computed is assembled from the 24 hours under it. That is the
// second reason hourly windows are stored, and `docs/summaries/` has the rest
// of it. A deployment computing hours alone reaches every range this way, and
// so does a day whose own run failed.

import type { RollupSummary, SummaryQuestion } from "../rollup-summaries.js";
import { neverComputed, summaryKey } from "../rollup-summaries.js";
import { hoursIn } from "../summary-coverage.js";
import type { SummaryWindow } from "../summary-windows.js";
import type { SummaryLocation } from "./summary-lookup.js";
import { readSummaries } from "./summary-lookup.js";

/** One window, and whatever answered it. */
export interface Covered {
  /** The window asked about. */
  readonly window: SummaryWindow;

  /** What answered it, and nothing where nothing has computed it. */
  readonly summaries: readonly RollupSummary[];
}

/** A range's windows, and what asking about them cost. */
export interface CoveredWindows {
  /** Each window in the order it was asked about. */
  readonly covered: readonly Covered[];

  /** How many objects were asked for, which is what the read cost. */
  readonly gets: number;
}

/** Each window with whatever answers it, days filled in from their hours. */
export async function coveredWindows(
  where: SummaryLocation,
  question: SummaryQuestion,
  windows: readonly SummaryWindow[],
): Promise<CoveredWindows> {
  const found = await fetched(where, question, windows);
  const missingDays = found.flatMap((covered, at) =>
    covered.summaries.length === 0 && covered.window.granularity === "daily"
      ? [{ at, window: covered.window }]
      : [],
  );

  if (missingDays.length === 0) {
    return { covered: found, gets: windows.length };
  }

  const hours = await Promise.all(
    missingDays.map(async (day) => wholeDay(where, question, day.window)),
  );
  const assembled = new Map(
    missingDays.map((day, which) => [day.at, hours[which]]),
  );

  return {
    covered: found.map((covered, at) => ({
      window: covered.window,
      summaries: assembled.get(at) ?? covered.summaries,
    })),
    gets: windows.length + missingDays.length * 24,
  };
}

/** Each window and whatever was under its key. */
async function fetched(
  where: SummaryLocation,
  question: SummaryQuestion,
  windows: readonly SummaryWindow[],
): Promise<readonly Covered[]> {
  const lookups = await readSummaries(
    where,
    windows.map((window) => summaryKey(question, window)),
  );

  return windows.map((window, at) => {
    const lookup = lookups[at];

    return {
      window,
      summaries:
        lookup === undefined || lookup === neverComputed ? [] : [lookup],
    };
  });
}

/**
 * The 24 hours of one day, where every one of them was computed.
 *
 * A day short of an hour comes back as nothing, and the day it stands for goes
 * on holding nothing. Twenty-three hours of a day is a number nobody asked
 * for, and the message about a missing day is the honest answer to a day that
 * is missing.
 */
async function wholeDay(
  where: SummaryLocation,
  question: SummaryQuestion,
  window: SummaryWindow,
): Promise<readonly RollupSummary[] | undefined> {
  const hours = await fetched(where, question, hoursIn(window));
  const summaries = hours.flatMap((covered) => covered.summaries);

  return summaries.length === 24 ? summaries : undefined;
}
