import { faker } from "@faker-js/faker";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { type App, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import {
  defaultLogDataset,
  defaultWorkgroupName,
  qualifiedTableName,
} from "../dataset.js";
import { rollups } from "../rollup-questions.js";
import type { Rollup } from "../rollups.js";
import { currentMonth, rollupRequest, rollupSql, rowsFor } from "../rollups.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable } from "./log-table.js";
import { QueryWorkgroup } from "./query-workgroup.js";
import { RollupQueries } from "./rollup-queries.js";

describe("the rollups saved in Athena", () => {
  /** The whole pipeline deployed, with the saved queries on top of it. */
  const deployRollups = async (saving?: readonly Rollup[]) => {
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

      new RollupQueries(stack, "RainlyticsRollups", {
        table,
        workgroup,
        rollups: saving,
      });
    });

    return simAws.region("us-east-1").account().athena().namedQueries();
  };

  it("saves one query for every question the command line answers", async () => {
    // Given the rollups.
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
      "rainlytics-searches",
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

  it("saves a rollup a site wrote for itself", async () => {
    // Given a question Rainlytics does not ship, written with the exported
    // builder and passed alongside the four.
    const countries: Rollup = {
      name: "countries",
      summary: "Count views by country.",
      description: "Counts where readers were, most read from first.",
      isRanked: true,
      body: (request) =>
        [
          "SELECT c_country AS country, count(*) AS views",
          `  FROM ${qualifiedTableName(request.dataset)}`,
          rowsFor(request, ["sc_content_type LIKE 'text/html%'"]),
          "  GROUP BY 1",
        ].join("\n"),
    };

    // When the stack is deployed.
    const saved = await deployRollups([...rollups, countries]);

    // Then it is in the console beside them, reading the current month the
    // way they do. A site with a question of its own gets the console copy
    // as well as the SQL.
    const own = saved.find((query) => query.name === "rainlytics-countries");

    expect(own?.queryString).toContain("year = date_format(current_date");
    expect(own?.queryString).toContain("sc_content_type LIKE 'text/html%'");
    expect(saved).toHaveLength(rollups.length + 1);
  });

  it("claims a command only where there is one", async () => {
    // Given a rollup the command line has no subcommand for.
    const nowhere: Rollup = {
      name: "elsewhere",
      summary: "Count something else.",
      description: "Counts something the command line never asks about.",
      isRanked: false,
      body: (request) =>
        ["SELECT count(*) AS rows", rowsFor(request)].join("\n"),
    };

    // When it is saved.
    const saved = await deployRollups([nowhere]);

    // Then its description says what it covers and stops. Naming
    // `rainlytics elsewhere` would send whoever reads it to a command that
    // does not exist.
    expect(saved[0]?.description).toBe(
      "Count something else. Over the current month.",
    );
  });

  it("refuses a name the console and the command line cannot share", async () => {
    // Given a rollup named the way a heading is written.
    const shouting: Rollup = {
      name: "Reader Searches",
      summary: "Count what readers searched for.",
      description: "Counts the queries readers typed.",
      isRanked: true,
      body: (request) => ["SELECT 1", rowsFor(request)].join("\n"),
    };

    // Then synthesis fails, rather than a deploy landing a query under a
    // name CDK had to mangle to make a logical id out of.
    await expect(deployRollups([shouting])).rejects.toThrow(/Reader Searches/u);
  });

  /** A question of a site's own, named and summarised to order. */
  const sized = (name: string, summary: string): Rollup => ({
    name,
    summary,
    description: "Counts something.",
    isRanked: false,
    body: (request) => ["SELECT count(*) AS rows", rowsFor(request)].join("\n"),
  });

  /** A rollup name of a given length, in the shape the rule allows. */
  const nameOf = (length: number): string => "a".repeat(length);

  it("saves a name that fills what Athena holds", async () => {
    // Given a name that is exactly the 128 characters Athena takes, once
    // the `rainlytics-` prefix is on it.
    const longest = sized(nameOf(128 - "rainlytics-".length), "Counts.");

    // When the stack is deployed.
    const saved = await deployRollups([longest]);

    // Then it is saved. The check has to admit the longest usable name, or
    // it is refusing something Athena would have taken.
    expect(saved[0]?.name).toHaveLength(128);
  });

  it("refuses a name longer than Athena would hold", async () => {
    // Given one character more than that.
    const overlong = sized(nameOf(129 - "rainlytics-".length), "Counts.");

    // Then synthesis fails. A deploy would run for a while and come back
    // with a validation message naming a field rather than a rollup.
    await expect(deployRollups([overlong])).rejects.toThrow(/129 characters/u);
  });

  it("refuses a summary that would overrun the description", async () => {
    // Given a summary long enough that the description built from it passes
    // 1,024 characters.
    const wordy = sized("countries", "Counts where readers were. ".repeat(40));

    // Then synthesis fails, and says which field to shorten.
    await expect(deployRollups([wordy])).rejects.toThrow(
      /Shorten the rollup's summary/u,
    );
  });
});
