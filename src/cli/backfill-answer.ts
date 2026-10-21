// Reading what one invocation of the summary function answered.

import type { BackfillProgress } from "../summary-backfill.js";
import { messageOf } from "../thrown-message.js";

/**
 * One invocation's answer, checked.
 *
 * A function deployed before backfills existed ignores the range, computes
 * the scheduled windows and answers with nothing. Lambda hands that back as
 * `null`, and the command says what it means.
 */
export function progressFrom(body: string): BackfillProgress {
  const progress = JSON.parse(body) as Partial<BackfillProgress> | null;

  if (progress === null || !Array.isArray(progress.computed)) {
    throw new Error(
      `The summary function answered ${body}, and a backfill answers with the` +
        ` windows it computed. A function deployed before Rainlytics could` +
        ` backfill ignores the range. Deploy RollupSummaries from this` +
        ` version first.`,
    );
  }

  return progress as BackfillProgress;
}

/** What Lambda reports a handler threw, out of its error payload. */
export function failureMessage(body: string): string {
  try {
    const { errorMessage } = JSON.parse(body) as { errorMessage?: unknown };

    return typeof errorMessage === "string" ? errorMessage : body;
  } catch (error) {
    return `${body} (${messageOf(error)})`;
  }
}
