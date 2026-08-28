// What the windows of one range came back as, once the gaps have been judged.
//
// Three things a reader has to decide once the objects are back. Windows
// missing from the two ends of a range are reported and dropped. A window
// missing from the middle stops the run. A range holding nothing at all stops
// it too.
//
// The two ends and the middle are different failures. A schedule computes a
// window a quarter of an hour after it closes, and a deployment made last
// Tuesday has nothing before Tuesday, so a range asked about today or about
// last month runs off the end of what exists. A hole in the middle is a run
// that failed, and an answer skipping it would be short by a whole window with
// nothing in the rows to say so.

import type { RollupSummary, SummaryQuestion } from "../rollup-summaries.js";
import type { SummaryWindow } from "../summary-windows.js";
import type { Covered } from "./summary-days.js";
import { coveredWindows } from "./summary-days.js";
import type { SummaryLocation } from "./summary-lookup.js";
import { holeIn, nothingComputed } from "./summary-refusals.js";

/** What the windows of one range came to. */
export interface SummaryCovering {
  /** The summaries that answered, oldest window first. */
  readonly summaries: readonly RollupSummary[];

  /** How many windows at the ends of the range have no summary. */
  readonly missing: number;

  /** How many objects were asked for, which is what the read cost. */
  readonly gets: number;
}

/**
 * The summaries covering a range, with the ends trimmed to what exists.
 *
 * @throws {Error} where nothing in the range has been computed, or where a
 *   window inside the span that has been computed is missing.
 */
export async function summaryCovering(
  where: SummaryLocation,
  question: SummaryQuestion,
  windows: readonly SummaryWindow[],
): Promise<SummaryCovering> {
  const { covered, gets } = await coveredWindows(where, question, windows);
  const last = lastHolding(covered);

  if (last === -1) {
    throw nothingComputed(windows);
  }

  const inside = covered.slice(
    covered.findIndex((one) => one.summaries.length > 0),
    last + 1,
  );
  const hole = inside.find((one) => one.summaries.length === 0);

  if (hole !== undefined) {
    throw holeIn(hole.window);
  }

  return {
    summaries: inside.flatMap((one) => one.summaries),
    missing: covered.length - inside.length,
    gets,
  };
}

/**
 * Where the newest window holding a summary is.
 *
 * Written as a scan because the compiler targets ES2022 and
 * `Array.findLastIndex` arrives in ES2023. Every runtime this ships to has it.
 */
function lastHolding(covered: readonly Covered[]): number {
  for (let at = covered.length - 1; at >= 0; at -= 1) {
    if ((covered[at]?.summaries.length ?? 0) > 0) {
      return at;
    }
  }

  return -1;
}
