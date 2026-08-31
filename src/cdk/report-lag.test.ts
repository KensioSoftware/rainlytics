import {
  assertIdentical,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { Duration } from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import {
  defaultReportLag,
  reportLagAfter,
  reportScheduleExpression,
} from "./report-lag.js";

describe("when the calendar report job runs", () => {
  it("fires once a day at the default lag", () => {
    assertIdentical(
      reportScheduleExpression(defaultReportLag),
      "cron(30 0 * * ? *)",
    );
  });

  it("writes hours and minutes into the schedule", () => {
    assertIdentical(
      reportScheduleExpression(Duration.minutes(125)),
      "cron(5 2 * * ? *)",
    );
  });

  it("stays fifteen minutes behind a later summary", () => {
    assertIdentical(reportLagAfter(Duration.minutes(50)).toMinutes(), 65);
  });

  it.each([Duration.seconds(90), Duration.days(1)])(
    "refuses a lag Scheduler cannot express within the closing day",
    (lag) => {
      const error = assertThrowsError(() => reportScheduleExpression(lag));
      assertStringMatches(
        error.message,
        /whole number of minutes under a day/u,
      );
    },
  );
});
