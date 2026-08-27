import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { gzipSync } from "node:zlib";

import { AthenaClient } from "@aws-sdk/client-athena";
import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { type App, CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib/core";
import { describe, expect, it, vi } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { CloudFrontLogDelivery } from "../cdk/log-delivery.js";
import { LogBucket } from "../cdk/log-bucket.js";
import { LogTable } from "../cdk/log-table.js";
import { QueryWorkgroup } from "../cdk/query-workgroup.js";
import { partitionPrefix } from "../partitions.js";
import { pageviews } from "../rollup-questions.js";
import type { RollupSummary } from "../rollup-summaries.js";
import {
  defaultRedirectStatuses,
  rollupRequest,
  rollupSql,
  summarisedWindow,
  windowPlaceholder,
} from "../rollups.js";
import { handler } from "./rollup-summary.js";
import { summaryEnvironment } from "./summary-run.js";

/*
 * The job as the Lambda runtime reaches it, which is the handler called with
 * an environment and a payload. `src/cdk/rollup-summaries.test.ts` covers the
 * deployed shape, where a schedule fires and the simulated runtime loads the
 * built function. These cases are the same code from the other side, and they
 * are where a failure it is meant to report is easy to arrange.
 */
describe("one run of the rollup summary job", () => {
  let intercepted: SimSdk | undefined;

  const anHour = new Date("2026-08-23T08:00:00.000Z");

  /** A pipeline in a simulated account, with the SDK pointed at it. */
  const deployAnalytics = async () => {
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
        new LogTable(stack, "RainlyticsTable", { deliveries: [delivery] });
        new QueryWorkgroup(stack, "RainlyticsQueries", {
          resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
        });
        new Bucket(stack, "Summaries", {
          bucketName: summariesBucketName,
          removalPolicy: RemovalPolicy.DESTROY,
        });
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();
    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(AthenaClient);
    intercepted.intercept(S3Client);

    vi.stubEnv(summaryEnvironment.database, "rainlytics");
    vi.stubEnv(summaryEnvironment.workgroup, "rainlytics");
    vi.stubEnv(summaryEnvironment.bucket, summariesBucketName);
    vi.stubEnv(summaryEnvironment.windows, "2");

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

  /** One delivered object holding one pageview. */
  const putDelivered = async (deployed: Deployed, at: Date): Promise<void> => {
    const prefix = partitionPrefix({
      distributionId: deployed.distributionId,
      at,
    });
    const record = {
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
    };

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${prefix}/${String(at.getTime())}.gz`,
          Body: gzipSync(JSON.stringify(record)),
        },
      });
  };

  /** The payload a schedule for the pageviews question carries. */
  const aRun = (sql?: string): unknown => ({
    question: {
      name: pageviews.name,
      includeBots: false,
      limit: 20,
      param: "q",
      redirectStatuses: defaultRedirectStatuses,
    },
    granularity: "hourly",
    sql:
      sql ?? rollupSql(pageviews, rollupRequest({ range: summarisedWindow })),
  });

  /**
   * A quarter past nine, on both clocks.
   *
   * The job asks the process what time it is, the way it does on Lambda. In
   * the deployed cases the simulated runtime answers, and here the process
   * clock is moved to meet the simulation instead. Only `Date` is replaced,
   * because the Athena poll waits on a real timer.
   */
  const atQuarterPast = (deployed: Deployed): void => {
    const quarterPast = new Date("2026-08-23T09:15:00.000Z");

    vi.useFakeTimers({ toFake: ["Date"], now: quarterPast });
    void deployed.simAws.clock().setTo(quarterPast);
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
      .getObject({ input: { Bucket: deployed.summariesBucketName, Key: key } })
      .catch(() => undefined);

    return found === undefined
      ? undefined
      : (JSON.parse(
          await text(found.Body as unknown as Readable),
        ) as RollupSummary);
  };

  /** The rows one summary holds, or nothing where none was written. */
  const rowsIn = async (
    deployed: Deployed,
    key: string,
  ): Promise<RollupSummary["rows"] | undefined> => {
    const summary = await summaryAt(deployed, key);

    return summary?.rows;
  };

  it("writes every window it was told to compute", async () => {
    // Given an hour of traffic, and a job set to compute two windows.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour);
    atQuarterPast(deployed);

    // When the job runs.
    await handler(aRun());

    // Then both closed hours are in the bucket. The trailing one is what
    // picks up a record CloudFront delivered after its window was first
    // computed.
    await expect(
      rowsIn(deployed, "summaries/v1/pageviews/hourly/2026-08-23T08Z.json"),
    ).resolves.toStrictEqual([{ path: "/", views: "1" }]);
    await expect(
      rowsIn(deployed, "summaries/v1/pageviews/hourly/2026-08-23T07Z.json"),
    ).resolves.toStrictEqual([]);
  });

  it("fails the run when Athena will not answer the question", async () => {
    // Given a query naming a column the table does not have.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour);
    atQuarterPast(deployed);

    // When the job runs it.
    const running = handler(
      aRun(
        `SELECT count(*) FROM "rainlytics"."gone"\n` +
          `  WHERE ${windowPlaceholder}\n`,
      ),
    );

    // Then the run fails rather than writing a summary of nothing. Nobody is
    // watching, so the throw is what puts it on the function's error metric
    // and in its log group.
    await expect(running).rejects.toThrow(/pageviews/u);
    await expect(
      summaryAt(deployed, "summaries/v1/pageviews/hourly/2026-08-23T08Z.json"),
    ).resolves.toBeUndefined();
  });
});
