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
  if (typeof thrown === "object" && thrown !== null) {
    const { name, message, stack } = thrown as Readonly<
      Record<string, unknown>
    >;

    return {
      name: typeof name === "string" ? name : typeof thrown,
      message: typeof message === "string" ? message : messageOf(thrown),
      ...(typeof stack === "string" ? { stack } : {}),
    };
  }

  return { name: typeof thrown, message: messageOf(thrown) };
}
