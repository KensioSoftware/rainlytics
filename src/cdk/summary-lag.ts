// How long after a window closes the job computes it, and the schedule
// expression that waits that long.

import { Duration } from "aws-cdk-lib/core";

import type { SummaryGranularity } from "../summary-windows.js";

/**
 * How long a run waits after a window closes, where nobody chooses otherwise.
 *
 * Fifteen minutes. CloudFront delivery was measured end to end at p50 169s
 * and a maximum of 373s across 200,074 records in
 * KensioSoftware/rainlytics#9, so an hour's objects have all landed by four
 * minutes past the next hour. Fifteen leaves eleven minutes of margin over
 * the worst record in that sample.
 *
 * A run on the hour with no lag would compute every hour before its last
 * records arrived, and would report a quiet tail on every one of them without
 * anything saying so. Raising this trades the freshness of an answer for
 * margin, and `recomputedWindows` covers what any lag misses.
 */
export const defaultSummaryLag = Duration.minutes(15);

/**
 * The Scheduler expression for one cadence at one lag.
 *
 * UTC in both cases, because the windows underneath are UTC. A daily run
 * fires once, in the hour after midnight UTC, and an hourly run fires in
 * every hour.
 *
 * @throws {Error} for a lag Scheduler cannot express as a minute of the hour.
 */
export function summaryScheduleExpression(
  granularity: SummaryGranularity,
  lag: Duration,
): string {
  const minutes = lagMinutes(lag);

  return granularity === "hourly"
    ? `cron(${String(minutes)} * * * ? *)`
    : `cron(${String(minutes)} 0 * * ? *)`;
}

/**
 * The lag as a minute of the hour.
 *
 * An hour is the shortest window Rainlytics stores, and a run has to happen
 * inside the window after the one it computes. A lag of an hour or more would
 * be a run computing a window two hours old under a schedule that reads as
 * though it kept up.
 *
 * @throws {Error} for a lag outside that, or one Scheduler cannot write.
 */
function lagMinutes(lag: Duration): number {
  const minutes = lag.toSeconds() / 60;

  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    throw new Error(
      `A summary lag has to be a whole number of minutes under an hour, and` +
        ` this one is ${lag.toString()}. The lag decides which minute of the` +
        ` hour a run fires on, and an hour is the shortest window stored.`,
    );
  }

  return minutes;
}
