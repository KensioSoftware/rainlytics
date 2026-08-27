import { faker } from "@faker-js/faker";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { type App, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { defaultLogDataset, defaultWorkgroupName } from "../dataset.js";
import { rollups } from "../rollup-questions.js";
import { currentMonth, rollupRequest, rollupSql } from "../rollups.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable } from "./log-table.js";
import { QueryWorkgroup } from "./query-workgroup.js";
import { RollupQueries } from "./rollup-queries.js";

describe("the rollups saved in Athena", () => {
  /** The whole pipeline deployed, with the saved queries on top of it. */
  const deployRollups = async () => {
    const { simAws } = await deployStacks((app: App, account: string) => {
      const stack = new Stack(app, "AnalyticsStack", {
        env: { account, region: "us-east-1" },
      });
      const logs = new LogBucket(stack, "RainlyticsLogs", {
        bucketName: `rainlytics-logs-${faker.string.uuid()}`,
      });
      const distribution = new Distribution(stack, "Site", {
        defaultBehavior: { origin: new HttpOrigin("origin.example.com") },
      });
      const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
        distributionId: distribution.distributionId,
        logBucket: logs.bucket,
      });
      const table = new LogTable(stack, "RainlyticsTable", {
        deliveries: [delivery],
      });
      const workgroup = new QueryWorkgroup(stack, "RainlyticsQueries", {
        resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
      });

      new RollupQueries(stack, "RainlyticsRollups", { table, workgroup });
    });

    return simAws.region("us-east-1").account().athena().namedQueries();
  };

  it("saves one query for every question the command line answers", async () => {
    // Given the four rollups.
    // When the stack is deployed.
    const saved = await deployRollups();

    // Then each is in the catalog under its own name. Somebody in the
    // console can read what `rainlytics pageviews` counts without reading
    // this repository.
    expect(saved.map((query) => query.name)).toStrictEqual([
      "rainlytics-pageviews",
      "rainlytics-referrers",
      "rainlytics-status-codes",
      "rainlytics-cache-hit-ratio",
    ]);
  });

  it("saves the SQL the command runs, not a description of it", async () => {
    // Given the saved queries.
    const saved = await deployRollups();

    // Then each holds exactly what the rollup builder writes for a standing
    // range. The command and the console copy come out of one builder, so
    // the two cannot drift into different answers to the same question.
    for (const [index, rollup] of rollups.entries()) {
      expect(saved[index]?.queryString).toBe(
        rollupSql(
          rollup,
          rollupRequest({ range: currentMonth, dataset: defaultLogDataset }),
        ),
      );
    }
  });

  it("saves them where they would run", async () => {
    // Given the saved queries.
    const saved = await deployRollups();

    // Then each names the workgroup carrying the cutoff and the database
    // holding the table. A saved query opened in the console runs where the
    // command would have run it.
    for (const query of saved) {
      expect(query.workGroupName).toBe(defaultWorkgroupName);
      expect(query.database).toBe(defaultLogDataset.databaseName);
    }
  });

  it("says which command each one belongs to", async () => {
    // Given the saved queries.
    const saved = await deployRollups();

    // Then the description names it. A console full of SQL with no
    // provenance is a console nobody trusts to edit.
    expect(saved[0]?.description).toContain('"rainlytics pageviews" runs');
    expect(saved[0]?.description).toContain("current month");
  });
});
