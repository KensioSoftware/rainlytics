// How long after local midnight the calendar report schedule fires.

import { Duration } from "aws-cdk-lib/core";

/** The report lag when the summary lag has its default value. */
export const defaultReportLag = Duration.minutes(30);

/** A daily Scheduler expression at one whole-minute lag after midnight. */
export function reportScheduleExpression(lag: Duration): string {
  const minutes = lag.toSeconds() / 60;

  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new Error(
      `A report lag has to be a whole number of minutes under a day, and` +
        ` this one is ${lag.toString()}.`,
    );
  }

  return `cron(${String(minutes % 60)} ${String(Math.floor(minutes / 60))} * * ? *)`;
}

/** The default report lag, moved after a later summary schedule if needed. */
export function reportLagAfter(summaryLag: Duration): Duration {
  const summaryMinutes = Math.floor(summaryLag.toSeconds() / 60);

  return Duration.minutes(
    Math.max(defaultReportLag.toMinutes(), summaryMinutes + 15),
  );
}
