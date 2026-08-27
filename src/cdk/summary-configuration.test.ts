import { faker } from "@faker-js/faker";
import { Bucket } from "aws-cdk-lib/aws-s3";
import type { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { App, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { pageviews, rollups } from "../rollup-questions.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogTable } from "./log-table.js";
import { QueryWorkgroup } from "./query-workgroup.js";
import { RollupSummaries } from "./rollup-summaries.js";
import type { RollupSummariesProps } from "./summary-configuration.js";

/*
 * What a deployment computes, read off the construct rather than out of a
 * synthesised template. `rollup-summaries.test.ts` deploys the same construct
 * into a simulated account and watches a summary land, and these cases are
 * the cheap ones about what was configured.
 */
describe("what a deployment of the summaries computes", () => {
  const summariesIn = (
    over: Partial<RollupSummariesProps> = {},
  ): RollupSummaries => {
    const stack = new Stack(new App(), "AnalyticsStack", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
      distributionId: "E1EXAMPLE1234",
      logBucket: new Bucket(stack, "Logs"),
    });

    return new RollupSummaries(stack, "RainlyticsSummaries", {
      table: new LogTable(stack, "Table", { deliveries: [delivery] }),
      workgroup: new QueryWorkgroup(stack, "Queries"),
      ...over,
    });
  };

  it("computes every shipped question on both cadences", () => {
    // Given a site that said nothing but where its table and workgroup are.
    const summaries = summariesIn();

    // Then it gets an hourly and a daily schedule for each of the questions
    // `rainlytics` answers, named after the question and the cadence.
    expect(summaries.schedules).toHaveLength(rollups.length * 2);
    expect(summaries.schedules.map((schedule) => schedule.name)).toContain(
      "rainlytics-pageviews-hourly",
    );
    expect(summaries.schedules.map((schedule) => schedule.name)).toContain(
      "rainlytics-cache-hit-ratio-daily",
    );
  });

  it("puts the question and its SQL in the schedule's input", () => {
    // Given a deployment of one question narrowed to a section of the site.
    const summaries = summariesIn({
      rollups: [pageviews],
      granularities: ["hourly"],
      requests: { pageviews: { paths: ["/guides/"] } },
    });

    // When the schedule's target input is read.
    const target = summaries.schedules[0]?.target as CfnSchedule.TargetProperty;
    const sent = JSON.parse(String(target.input)) as {
      question: { paths: string[] };
      sql: string;
    };

    // Then the job is told what to count and what to run, and the query is
    // legible in the template rather than assembled at run time.
    expect(sent.question.paths).toStrictEqual(["/guides/"]);
    expect(sent.sql).toContain("strpos");
    expect(sent.sql).toContain("SELECT");
  });

  it("refuses a request naming a question it is not computing", () => {
    // Given a narrowing keyed on a question nobody is computing, which is a
    // rollup name typed by hand.
    const building = (): unknown =>
      summariesIn({
        rollups: [pageviews],
        requests: { [faker.word.noun()]: { limit: 5 } },
      });

    // Then it is refused at synthesis, where somebody can still read the
    // message. Left alone, the narrowing would go quietly unapplied.
    expect(building).toThrow(/No rollup/u);
  });
});
