import {
  assertIdentical,
  assertObjectEquals,
  assertStringIncludes,
  assertUndefined,
} from "@kensio/smartass";
import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { gzipSync } from "node:zlib";

import { LambdaClient } from "@aws-sdk/client-lambda";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  type App,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
} from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { CloudFrontLogDelivery } from "../cdk/log-delivery.js";
import { LogBucket } from "../cdk/log-bucket.js";
import { LogTable } from "../cdk/log-table.js";
import { QueryWorkgroup } from "../cdk/query-workgroup.js";
import { RollupSummaries } from "../cdk/rollup-summaries.js";
import { partitionPrefix } from "../partitions.js";
import { pageviews } from "../rollup-questions.js";
import type { RollupSummary } from "../rollup-summaries.js";
import { defaultVisitorSaltParameter } from "../visitor-identity.js";
import { rainlyticsCommands } from "./command.js";
import { runCli } from "./run.js";

describe("rainlytics backfill", () => {
  /** The interception in force, for the reason `query-command.test.ts` gives. */
  let intercepted: SimSdk | undefined;

  /** What one run of the CLI wrote, and what it exited with. */
  interface Run {
    readonly code: number;
    readonly out: string;
    readonly error: string;
  }

  /**
   * A deployment computing pageviews hourly, with the SDK pointed at it.
   *
   * The function's timeout is twenty seconds, under the half minute a
   * backfill keeps in hand, so every invocation computes one window and hands
   * the rest on. That is the path a month of hours takes on a real
   * deployment, at a size a test can run.
   */
  const deployAnalytics = async (site: { readonly salt?: boolean } = {}) => {
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
    const summariesBucketName = `rainlytics-summaries-${faker.string.uuid()}`;

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

        new RollupSummaries(stack, "RainlyticsSummaries", {
          table,
          workgroup,
          rollups: [pageviews],
          granularities: ["hourly"],
          summariesBucketName,
          removalPolicy: RemovalPolicy.DESTROY,
          timeout: Duration.seconds(20),
        });
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();
    if (site.salt !== false) {
      await simAws
        .region("us-east-1")
        .account()
        .ssm()
        .putParameter({
          input: {
            Name: defaultVisitorSaltParameter,
            Type: "SecureString",
            Value: faker.string.hexadecimal({ length: 64, prefix: "" }),
          },
        });
    }

    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(SchedulerClient);
    intercepted.intercept(LambdaClient);

    return {
      simAws,
      logBucketName,
      summariesBucketName,
      distributionId: String(
        stacks.get("AnalyticsStack")?.output("DistributionId"),
      ),
    };
  };

  type Deployed = Awaited<ReturnType<typeof deployAnalytics>>;

  /** One delivered object holding one pageview of the home page. */
  const putDelivered = async (deployed: Deployed, at: Date): Promise<void> => {
    const record = JSON.stringify({
      "timestamp(ms)": String(at.getTime()),
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
      "c-ip": faker.internet.ipv4(),
    });
    const prefix = partitionPrefix({
      distributionId: deployed.distributionId,
      at,
    });

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${prefix}/${String(at.getTime())}.gz`,
          Body: gzipSync(record),
        },
      });
  };

  /** Whatever is under one key in the summaries bucket. */
  const summaryAt = async (
    deployed: Deployed,
    key: string,
  ): Promise<RollupSummary | undefined> => {
    const found = await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .getObject({
        input: { Bucket: deployed.summariesBucketName, Key: key },
      })
      .catch(() => undefined);

    return found === undefined
      ? undefined
      : (JSON.parse(
          await text(found.Body as unknown as Readable),
        ) as RollupSummary);
  };

  /**
   * Runs the CLI while simulated time passes, and reads both streams.
   *
   * A synchronous invocation holds the command until the function returns,
   * and the function waits on Athena with timers that only simulated time
   * passing releases. The simulation's clock stands still unless something
   * moves it, so this moves it a little at a time until the command is done.
   */
  const cliWhileTimePasses = async (
    deployed: Deployed,
    argv: readonly string[],
  ): Promise<Run> => {
    const state = { settled: false };
    const running = cli(argv).finally(() => {
      state.settled = true;
    });

    while (!state.settled) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await deployed.simAws.clock().advanceBy({ milliseconds: 100 });
      // oxlint-disable-next-line eslint/no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
    }

    return running;
  };

  /** Runs the CLI the way the executable does, and reads both streams. */
  const cli = async (argv: readonly string[]): Promise<Run> => {
    let out = "";
    let error = "";
    const code = await runCli({
      argv,
      commands: rainlyticsCommands,
      io: {
        out: (written) => {
          out += written;
        },
        error: (written) => {
          error += written;
        },
        outIsTerminal: false,
      },
    });

    return { code, out, error };
  };

  /*
   * The simulation starts at 09:00 on 2026-08-23, so the four hours before
   * it have closed. The keys are written out from `docs/summaries/`.
   */
  const fourHours = [
    "backfill",
    "pageviews",
    "hourly",
    "--from",
    "2026-08-23T05:00Z",
    "--until",
    "2026-08-23T09:00Z",
    "--region",
    "us-east-1",
  ];

  it("fills in every window of the range from the schedule's own payload", async () => {
    // Given traffic in two hours that no scheduled run ever computed.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, new Date("2026-08-23T05:30:00.000Z"));
    await putDelivered(deployed, new Date("2026-08-23T08:30:00.000Z"));

    // When somebody backfills those four hours.
    const run = await cliWhileTimePasses(deployed, fourHours);

    // Then every hour has its summary, each invocation is a row of the
    // answer, and standard error said what it would cost before it started.
    assertIdentical(run.code, 0, run.error);
    for (const [hour, rows] of [
      ["05", [{ path: "/", views: "1" }]],
      ["06", []],
      ["07", []],
      ["08", [{ path: "/", views: "1" }]],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const summary = await summaryAt(
        deployed,
        `summaries/v1/pageviews/hourly/2026-08-23T${hour}Z.json`,
      );
      assertObjectEquals(summary?.rows, rows);
    }
    assertObjectEquals(JSON.parse(run.out), [
      {
        invocation: 1,
        windows: 1,
        first: "2026-08-23T05:00:00.000Z",
        last: "2026-08-23T05:00:00.000Z",
      },
      {
        invocation: 2,
        windows: 1,
        first: "2026-08-23T06:00:00.000Z",
        last: "2026-08-23T06:00:00.000Z",
      },
      {
        invocation: 3,
        windows: 1,
        first: "2026-08-23T07:00:00.000Z",
        last: "2026-08-23T07:00:00.000Z",
      },
      {
        invocation: 4,
        windows: 1,
        first: "2026-08-23T08:00:00.000Z",
        last: "2026-08-23T08:00:00.000Z",
      },
    ]);
    assertStringIncludes(run.error, "4 hourly window(s)");
    assertStringIncludes(
      run.error,
      "8 Athena queries, billed at least $0.00040",
    );
    assertStringIncludes(run.error, "The range is done.");
  });

  it("names the prefix when there is no schedule to read", async () => {
    // Given a deployment whose schedules carry the default prefix.
    const deployed = await deployAnalytics();

    // When somebody names another one.
    const run = await cli([...fourHours, "--schedule-prefix", "docs-"]);

    // Then the command fails pointing at the option, having written nothing.
    assertIdentical(run.code, 1);
    assertStringIncludes(run.error, "docs-pageviews-hourly");
    assertStringIncludes(run.error, "--schedule-prefix");
    assertUndefined(
      await summaryAt(
        deployed,
        "summaries/v1/pageviews/hourly/2026-08-23T05Z.json",
      ),
    );
  });

  it("reports what the function said when it fails", async () => {
    // Given a deployment whose visitor salt was never created, which is how
    // the windows went missing in the first place.
    await deployAnalytics({ salt: false });

    // When somebody backfills before creating it.
    const run = await cli(fourHours);

    // Then the command fails with the function's own reason.
    assertIdentical(run.code, 1);
    assertStringIncludes(run.error, "The summary function failed.");
    assertStringIncludes(run.error, defaultVisitorSaltParameter);
  });

  it("refuses a range it cannot read before asking AWS anything", async () => {
    for (const [argv, said] of [
      [["backfill", "pageviews", "hourly"], "--from"],
      [["backfill", "pageviews", "weekly", "--from", "2026-09-11"], "weekly"],
      [["backfill", "pageviews", "daily", "--from", "2026-02-30"], "--from"],
      [
        ["backfill", "pageviews", "hourly", "--from", "2026-09-11T06:00"],
        "offset",
      ],
      [
        [
          "backfill",
          "pageviews",
          "daily",
          "--from",
          "2026-09-12",
          "--until",
          "2026-09-11",
        ],
        "earlier",
      ],
      [["backfill", "pageviews", "--from", "2026-09-11"], "granularity"],
      [
        ["backfill", "pageviews", "hourly", "--from", "2026-02-30T06:00Z"],
        "--from",
      ],
      [["backfill", "pageviews", "daily", "--from", "2999-01-01"], "earlier"],
      [
        [
          "backfill",
          "pageviews",
          "daily",
          "--from",
          "2999-01-01",
          "--until",
          "2999-01-02",
        ],
        "has closed yet",
      ],
    ] as const) {
      // Given a command line that is wrong.
      // When it runs.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const run = await cli(argv);

      // Then it exits as a usage error saying what was wrong.
      assertIdentical(run.code, 2, argv.join(" "));
      assertStringIncludes(run.error, said);
    }
  });
});
