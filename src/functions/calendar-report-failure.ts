// Recording one failed period before the scheduled invocation fails.

import type { ReportPeriod } from "../report-periods.js";
import { messageOf } from "../thrown-message.js";

/** Logs a period's original error and returns its aggregate entry. */
export function calendarReportFailure(
  period: ReportPeriod,
  thrown: unknown,
): Error {
  // oxlint-disable-next-line eslint/no-console
  console.error(
    JSON.stringify({
      event: "calendar-report-failed",
      unit: period.unit,
      startsOn: period.startsOn,
      cause: loggedError(thrown),
    }),
  );

  return new Error(
    `The ${period.unit} report starting ${period.startsOn} failed.`,
    { cause: thrown },
  );
}

/** The fields from a thrown value that an operator needs in the log. */
function loggedError(thrown: unknown): Readonly<{
  name: string;
  message: string;
  stack?: string;
}> {
  if (thrown instanceof Error) {
    return {
      name: thrown.name,
      message: thrown.message,
      ...(thrown.stack === undefined ? {} : { stack: thrown.stack }),
    };
  }

  return { name: typeof thrown, message: messageOf(thrown) };
}
