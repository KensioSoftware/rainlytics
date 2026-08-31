import {
  assertIdentical,
  assertObjectEquals,
  assertStringIncludes,
  assertStringMatches,
} from "@kensio/smartass";
import { gzipSync } from "node:zlib";

import { AthenaClient } from "@aws-sdk/client-athena";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { type App, CfnOutput, Stack } from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import { readingAthenaCaller } from "#test/reading-athena-caller.js";
import { deployStacks, simStartedAt } from "#test/simulated-deployment.js";

import { CloudFrontLogDelivery } from "../cdk/log-delivery.js";
import { LogBucket } from "../cdk/log-bucket.js";
import { LogTable } from "../cdk/log-table.js";
import { QueryWorkgroup } from "../cdk/query-workgroup.js";
import type { RollupQueriesProps } from "../cdk/rollup-queries.js";
import { RollupQueries } from "../cdk/rollup-queries.js";
import { qualifiedTableName } from "../dataset.js";
import { partitionPrefix } from "../partitions.js";
import { rollups } from "../rollup-questions.js";
import type { Rollup } from "../rollups.js";
import { rowsFor } from "../rollups.js";
import { rainlyticsCommands } from "./command.js";
import { runCli } from "./run.js";

describe("rainlytics saved-query", () => {
  /**
   * The interception in force, so the next deployment can take it off first.
   *
   * `SimSdk` refuses to intercept a client that is already intercepted, and
   * the command builds its own clients, so the target has to be the class.
   */
  let intercepted: SimSdk | undefined;

  /**
   * A question Rainlytics does not ship, assembled from the exported parts.
   *
   * This is the case the command exists for. A site writes it, saves it
   * beside the built-in ones, and runs it by name without this package ever
   * having heard of it.
   */
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
        "  ORDER BY 2 DESC, 1",
        `  LIMIT ${String(request.limit)}`,
      ].join("\n"),
  };

  /**
   * The readable pipeline in a simulated account, with the saved queries on
   * top of it and the AWS SDK pointed at the lot.
   *
   * The clock stays where `deployStacks` starts it. A saved query asks Athena
   * what month it is, so the records these cases deliver and the month the
   * saved SQL prunes to have to come from one clock.
   *
   * `saving` is undefined for a deployment with no saved queries at all,
   * which is what a workgroup looks like before anyone deploys the construct.
   */
  const deployAnalytics = async (
    saving?: Pick<RollupQueriesProps, "rollups" | "requests">,
  ) => {
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;

    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "AnalyticsStack", {
          env: { account, region: "us-east-1" },
        });
        const logs = new LogBucket(stack, "RainlyticsLogs", {
          bucketName: logBucketName,
        });
        const distribution = new Distribution(stack, "Site", {
          defaultBehavior: { origin: new HttpOrigin("origin.example.com") },
        });
        new CfnOutput(stack, "DistributionId", {
          value: distribution.distributionId,
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

        if (saving !== undefined) {
          new RollupQueries(stack, "RainlyticsRollups", {
            table,
            workgroup,
            ...saving,
          });
        }
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();

    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(AthenaClient);

    return {
      simAws,
      logBucketName,
      distributionId: String(
        stacks.get("AnalyticsStack")?.output("DistributionId"),
      ),
    };
  };

  type Deployed = Awaited<ReturnType<typeof deployAnalytics>>;

  /** One record, with everything these questions read set to something. */
  const aRecord = (
    over: Readonly<Record<string, string>> = {},
  ): Readonly<Record<string, string>> => ({
    "timestamp(ms)": String(simStartedAt.getTime()),
    "x-host-header": "www.example.com",
    "cs-method": "GET",
    "cs-uri-stem": "/",
    "cs-uri-query": "-",
    "sc-status": "200",
    "sc-content-type": "text/html",
    "cs(Referer)": "-",
    "cs(User-Agent)": "Mozilla/5.0%20(Macintosh)",
    "x-edge-result-type": "Hit",
    "c-country": "GB",
    ...over,
  });

  /** One delivered object holding these records, in this month's partition. */
  const putDelivered = async (
    deployed: Deployed,
    records: readonly Readonly<Record<string, string>>[],
  ): Promise<void> => {
    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${partitionPrefix({
            distributionId: deployed.distributionId,
            at: simStartedAt,
          })}/${String(simStartedAt.getTime())}.gz`,
          Body: gzipSync(
            records.map((record) => JSON.stringify(record)).join("\n"),
          ),
        },
      });
  };

  /** Runs the CLI the way the executable does, and reads both streams. */
  const cli = async (argv: readonly string[]) => {
    let out = "";
    let error = "";
    const code = await runCli({
      argv,
      commands: rainlyticsCommands,
      io: {
        out: (text) => {
          out += text;
        },
        error: (text) => {
          error += text;
        },
        outIsTerminal: false,
      },
    });

    return { code, out, error, rows: out === "" ? [] : JSON.parse(out) };
  };

  it("runs a question this package never shipped", async () => {
    // Given a site that wrote a rollup of its own and saved it in the
    // workgroup, and an hour of readers in two countries.
    const deployed = await deployAnalytics({
      rollups: [...rollups, countries],
    });

    await putDelivered(deployed, [
      aRecord(),
      aRecord(),
      aRecord({ "c-country": "FR" }),
    ]);

    // When it is run by name.
    const run = await cli(["saved-query", "countries"]);

    // Then the answer comes back with the options and the output every other
    // command has. Nothing here loaded the site's code or built anything.
    assertIdentical(run.code, 0);
    assertObjectEquals(run.rows, [
      { country: "GB", views: "2" },
      { country: "FR", views: "1" },
    ]);
  });

  it("takes the name Athena lists as readily as the rollup's own", async () => {
    // Given the same saved query, which Athena holds under a prefixed name.
    const deployed = await deployAnalytics({
      rollups: [...rollups, countries],
    });
    await putDelivered(deployed, [aRecord()]);

    // When it is asked for the way the console spells it.
    const run = await cli(["saved-query", "rainlytics-countries"]);

    // Then it runs. Somebody reading a name out of the console and somebody
    // typing the rollup name they gave it arrive at the same query.
    assertIdentical(run.code, 0);
    assertObjectEquals(run.rows, [{ country: "GB", views: "1" }]);
  });

  it("runs the question as it was saved, filters and all", async () => {
    // Given a saved copy narrowed to one of the two sites the distribution
    // serves, and traffic to both.
    const host = faker.internet.domainName();
    const deployed = await deployAnalytics({
      requests: { pageviews: { host } },
    });

    await putDelivered(deployed, [
      aRecord({ "x-host-header": host }),
      aRecord({ "x-host-header": host }),
      aRecord({ "x-host-header": "elsewhere.example.com" }),
    ]);

    // When the saved copy runs.
    const run = await cli(["saved-query", "pageviews"]);

    // Then it counts the site it was saved for. The narrowing lives in the
    // SQL Athena holds, and this command sends that SQL rather than building
    // its own from what was typed.
    assertObjectEquals(run.rows, [{ path: "/", views: "2" }]);
  });

  it("finds a query past the first page Athena lists", async () => {
    // Given a workgroup holding more saved queries than Athena lists in one
    // page, which it caps at fifty, with the one being asked for last.
    const filler = Array.from({ length: 60 }, (_unused, index) => ({
      ...countries,
      name: `filler-${String(index)}`,
    }));
    const deployed = await deployAnalytics({
      rollups: [...filler, countries],
    });

    await putDelivered(deployed, [aRecord()]);

    // When it is run by name.
    const run = await cli(["saved-query", "countries"]);

    // Then every page of ids was followed. A lookup stopping at the first
    // page would report a saved query as missing, and list sixty others to
    // prove it.
    assertIdentical(run.code, 0);
    assertObjectEquals(run.rows, [{ country: "GB", views: "1" }]);
  });

  it("says what is saved where the name reaches nothing", async () => {
    // Given the rollups saved in the workgroup, and a name with a letter
    // missing.
    const deployed = await deployAnalytics({
      rollups: [...rollups, countries],
    });
    await putDelivered(deployed, [aRecord()]);

    // When that name is run.
    const run = await cli(["saved-query", "countrie"]);

    // Then the message names what it could have run. A saved query is
    // deployed from somewhere else and listed in a console the reader may
    // not have open, so "no such query" on its own leaves them guessing.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, 'is called "countrie"');
    assertStringIncludes(run.error, '"rainlytics-countries"');
    assertStringIncludes(run.error, '"rainlytics-pageviews"');
  });

  it("says so where the workgroup holds nothing at all", async () => {
    // Given a deployment that never saved a query.
    await deployAnalytics();

    // When one is asked for.
    const run = await cli(["saved-query", "countries"]);

    // Then the answer points at what saves them, since an empty list says
    // nothing about how to fill it.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, "Nothing is saved in workgroup rainlytics");
    assertStringIncludes(run.error, "RollupQueries");
  });

  it("says what the query scanned and what it came to", async () => {
    // Given a saved query and something for it to read.
    const deployed = await deployAnalytics({
      rollups: [...rollups, countries],
    });
    await putDelivered(deployed, [aRecord()]);

    // When it runs.
    const run = await cli(["saved-query", "countries"]);

    // Then the price of the question is in front of whoever just asked it,
    // on standard error, the way every other command reports it.
    assertStringMatches(run.error, /Query \S+ ran in workgroup rainlytics/u);
    assertStringIncludes(run.error, "About $0.000050");
  });

  it("carries no range or row count for a reader to type", async () => {
    // Given a saved query.
    await deployAnalytics({ rollups: [...rollups, countries] });

    // When somebody asks for a range the way a rollup command takes one.
    const run = await cli(["saved-query", "countries", "--last", "7d"]);

    // Then the option is refused rather than accepted and ignored. The saved
    // SQL carries a range of its own, and a command that took `--last` here
    // would answer a different question from the one it was given.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, "--last");
    assertStringIncludes(run.error, 'Run "rainlytics saved-query --help"');
  });

  it("looks in the workgroup it is told to", async () => {
    // Given a deployment whose workgroup was left at its default.
    await deployAnalytics({ rollups: [...rollups, countries] });

    // When a query is looked for in a workgroup that was never created.
    const run = await cli([
      "saved-query",
      "countries",
      "--workgroup",
      "not-a-workgroup",
    ]);

    // Then Athena refuses it there. A saved query is found and run in one
    // workgroup, and running one somewhere else is running it with no
    // ceiling on what it can scan.
    assertIdentical(run.code, 1);
    assertStringIncludes(run.error, "not-a-workgroup");
  });

  it("asks Athena in the region it was told to", async () => {
    // Given a deployment in us-east-1, which is where the saved queries are.
    await deployAnalytics({ rollups: [...rollups, countries] });

    // When the same name is asked for somewhere else.
    const run = await cli([
      "saved-query",
      "countries",
      "--region",
      "eu-west-1",
    ]);

    // Then the message says where it looked, which Athena's own never does.
    assertIdentical(run.code, 1);
    assertStringIncludes(run.error, "Athena was asked in eu-west-1");
  });

  it("names the actions a saved query takes, where the caller has none", async () => {
    // Given a saved query, and an identity allowed to read Athena and to run
    // nothing.
    const deployed = await deployAnalytics({
      rollups: [...rollups, countries],
    });
    await putDelivered(deployed, [aRecord()]);
    const reader = await readingAthenaCaller(deployed.simAws);

    // When it runs the saved query by name.
    const run = await deployed.simAws.runAs(reader, async () =>
      cli(["saved-query", "countries"]),
    );

    // Then the four actions are named. Listing the saved queries is a read,
    // so this identity finds the query and is stopped at running it.
    assertIdentical(run.code, 1);
    assertStringIncludes(
      run.error,
      "Running a query takes athena:StartQueryExecution and" +
        " athena:StopQueryExecution",
    );
    assertStringIncludes(run.error, "s3:PutObject and s3:AbortMultipartUpload");

    // And the summaries are offered here too, since a site's own question and
    // the six shipped ones run the same way.
    assertStringIncludes(run.error, "--summaries");
  });

  it("refuses to run with no name at all", async () => {
    // Given the command on its own.
    const run = await cli(["saved-query"]);

    // Then it asks for the name, and nothing reaches Athena.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, "takes the name of a saved query");
  });

  it("refuses a name the shell took apart", async () => {
    // Given a saved query whose name holds a space, typed unquoted.
    const run = await cli(["saved-query", "my", "countries"]);

    // Then it says so. Athena allows a space in a name, and running the
    // first word would look for a query nobody saved.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, "takes one name and got 2");
  });
});
