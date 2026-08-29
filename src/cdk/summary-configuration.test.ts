import { faker } from "@faker-js/faker";
import type { Policy } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import type { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { App, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { logFieldNamesWithoutAddress } from "../log-fields.js";
import { pageviews, rollups } from "../rollup-questions.js";
import { withoutVisitorCount } from "../rollups.js";
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
    fields?: readonly string[],
  ): RollupSummaries => {
    const stack = new Stack(new App(), "AnalyticsStack", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
      distributionId: "E1EXAMPLE1234",
      logBucket: new Bucket(stack, "Logs"),
      ...(fields === undefined ? {} : { fields }),
    });

    return new RollupSummaries(stack, "RainlyticsSummaries", {
      table: new LogTable(stack, "Table", { deliveries: [delivery] }),
      workgroup: new QueryWorkgroup(stack, "Queries"),
      ...over,
    });
  };

  /** The actions the summary function's role was granted. */
  const grantedActions = (summaries: RollupSummaries): readonly string[] => {
    const policy = summaries.lambda.role?.node.tryFindChild(
      "DefaultPolicy",
    ) as Policy;
    const document = Stack.of(summaries).resolve(policy.document) as {
      readonly Statement: readonly {
        readonly Action: string | readonly string[];
      }[];
    };

    return document.Statement.flatMap((statement) => [statement.Action].flat());
  };

  /** The visitor SQL a schedule carries, where it carries any. */
  const visitorSqlOf = (
    schedule: CfnSchedule | undefined,
  ): string | undefined => {
    const target = schedule?.target as CfnSchedule.TargetProperty;

    return (JSON.parse(String(target.input)) as { visitorSql?: string })
      .visitorSql;
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

  it("keeps a second deployment's schedules apart from the first one's", () => {
    // Given a site measuring a second distribution from the same account. A
    // schedule's name is unique within its group, so the two deployments
    // would otherwise collide on `rainlytics-pageviews-hourly`.
    const summaries = summariesIn({
      rollups: [pageviews],
      granularities: ["hourly"],
      schedulePrefix: "docs-",
    });

    // Then the schedules are named for that deployment.
    expect(summaries.schedules.map((schedule) => schedule.name)).toStrictEqual([
      "docs-pageviews-hourly",
    ]);
  });

  it("counts visitors where the table carries the viewer's address", () => {
    // Given a deployment over a table built from the default field set.
    const summaries = summariesIn({
      rollups: [pageviews],
      granularities: ["hourly"],
    });

    // Then the schedule carries a second query counting them, salted per day,
    // and the job may read the salt.
    expect(visitorSqlOf(summaries.schedules[0])).toContain("c_ip");
    expect(grantedActions(summaries)).toContain("ssm:GetParameter");
  });

  it("counts no visitors where the delivery left the address out", () => {
    // Given a site delivering a field set with no viewer address, which is
    // the one configuration holding no personal data.
    const summaries = summariesIn(
      { granularities: ["hourly"] },
      logFieldNamesWithoutAddress,
    );

    // Then it still computes every shipped question, and none of them carries
    // a query naming a column the table has never heard of.
    expect(summaries.schedules).toHaveLength(rollups.length);
    for (const schedule of summaries.schedules) {
      expect(visitorSqlOf(schedule)).toBeUndefined();
    }
  });

  it("reads no salt for a deployment counting no visitors", () => {
    // Given the same deployment, whose SSM parameter nobody has created.
    const summaries = summariesIn(
      { granularities: ["hourly"] },
      logFieldNamesWithoutAddress,
    );

    // When the function's policy is read.
    const actions = grantedActions(summaries);

    // Then it was granted nothing on Systems Manager, while keeping the reads
    // its queries need. A site running no count has no parameter to point
    // that permission at.
    expect(actions).toContain("athena:StartQueryExecution");
    expect(actions).not.toContain("ssm:GetParameter");
  });

  it("takes a named question whose visitor count was turned off", () => {
    // Given a site delivering no address and naming the one question it
    // wants, with the count taken off it.
    const summaries = summariesIn(
      { rollups: [withoutVisitorCount(pageviews)], granularities: ["hourly"] },
      logFieldNamesWithoutAddress,
    );

    // Then it deploys, and the schedule carries the question without a count.
    expect(summaries.schedules).toHaveLength(1);
    expect(visitorSqlOf(summaries.schedules[0])).toBeUndefined();
  });

  it("refuses a question that counts visitors the table cannot identify", () => {
    // Given a site that left the address out of the delivery and then asked
    // for the visitor count by name anyway.
    const building = (): unknown =>
      summariesIn(
        { rollups: [pageviews], granularities: ["hourly"] },
        logFieldNamesWithoutAddress,
      );

    // Then it is refused at synthesis. Dropping the count silently would run
    // a deployment computing something other than what its code asked for,
    // and running it would fail hourly against a missing column.
    expect(building).toThrow(/counts visitors/u);
    expect(building).toThrow(/c-ip/u);
  });

  it("refuses a deployment that would compute nothing", () => {
    // Given a site that passed an empty list of questions, which is not the
    // same as leaving the prop out.
    const building = (): unknown => summariesIn({ rollups: [] });

    // Then it is refused at synthesis, rather than deploying a function
    // nothing invokes and a bucket nothing writes to.
    expect(building).toThrow(/computes nothing/u);
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
