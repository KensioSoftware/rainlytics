import { faker } from "@faker-js/faker";
import { Duration } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { defaultSummaryLag, summaryScheduleExpression } from "./summary-lag.js";

describe("when a run happens", () => {
  it("fires every hour at the lag past it", () => {
    // Given a deployment computing hours on a twenty minute lag.
    const lag = Duration.minutes(20);

    // When the schedule expression is written.
    const expression = summaryScheduleExpression("hourly", lag);

    // Then it fires twenty minutes into every hour.
    expect(expression).toBe("cron(20 * * * ? *)");
  });

  it("fires once a day, in the hour after midnight UTC", () => {
    // Given a deployment computing days on the default lag.
    // When the schedule expression is written.
    const expression = summaryScheduleExpression("daily", defaultSummaryLag);

    // Then it fires once, a quarter of an hour after the day it computes
    // closed. The windows underneath are UTC and so is the run.
    expect(expression).toBe("cron(15 0 * * ? *)");
  });

  it("waits long enough for CloudFront to have delivered the hour", () => {
    // Given the delivery latency KensioSoftware/rainlytics#9 measured, whose
    // worst record of 200,074 arrived 373 seconds after the request.
    const slowestDelivery = Duration.seconds(373);

    // Then the default leaves margin over it. An hour's objects have all
    // landed by four minutes past the next hour, and a run on the hour would
    // drop the tail of every hour without anything saying so.
    expect(defaultSummaryLag.toSeconds()).toBeGreaterThan(
      slowestDelivery.toSeconds(),
    );
  });

  it("refuses a lag of an hour or more", () => {
    // Given a lag as long as the shortest window stored.
    const writing = (): unknown =>
      summaryScheduleExpression(
        "hourly",
        Duration.hours(faker.number.int({ min: 1, max: 9 })),
      );

    // Then it is refused. The lag decides which minute of the hour a run
    // fires on, and an hour of it would be a run computing a window two hours
    // old under a schedule that reads as though it kept up.
    expect(writing).toThrow(/whole number of minutes/u);
  });

  it("refuses a lag Scheduler cannot write as a minute", () => {
    // Given a lag of ninety seconds.
    const writing = (): unknown =>
      summaryScheduleExpression("hourly", Duration.seconds(90));

    // Then it is refused rather than rounded to something nobody asked for.
    expect(writing).toThrow(/whole number of minutes/u);
  });
});
