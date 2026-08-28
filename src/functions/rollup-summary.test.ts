import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { gzipSync } from "node:zlib";

import { AthenaClient } from "@aws-sdk/client-athena";
import { S3Client } from "@aws-sdk/client-s3";
import { SSMClient } from "@aws-sdk/client-ssm";
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
import { defaultVisitorSaltParameter } from "../visitor-identity.js";
import { visitorSaltPlaceholder } from "../visitor-identity.js";
import { handler } from "./rollup-summary.js";
import { summaryEnvironment } from "./summary-deployment.js";

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
  const saltParameter = defaultVisitorSaltParameter;

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

    // What the previous case in this file replaced, put back before this one
    // replaces it again. `Date` is faked because the job asks the process
    // what time it is, the way it does on Lambda.
    vi.useRealTimers();
    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(AthenaClient);
    intercepted.intercept(S3Client);
    intercepted.intercept(SSMClient);

    // The salt secret, put where a site's operator puts it. Nothing in a
    // stack creates it, because CloudFormation writes no SecureString.
    await simAws
      .region("us-east-1")
      .account()
      .ssm()
      .putParameter({
        input: {
          Name: saltParameter,
          Type: "SecureString",
          Value: faker.string.hexadecimal({ length: 64, prefix: "" }),
        },
      });

    vi.stubEnv(summaryEnvironment.database, "rainlytics");
    vi.stubEnv(summaryEnvironment.workgroup, "rainlytics");
    vi.stubEnv(summaryEnvironment.bucket, summariesBucketName);
    vi.stubEnv(summaryEnvironment.windows, "2");
    vi.stubEnv(summaryEnvironment.visitorSaltParameter, saltParameter);

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

  /** One delivered object holding one pageview from one address. */
  const putDelivered = async (
    deployed: Deployed,
    at: Date,
    address = "203.0.113.7",
  ): Promise<void> => {
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
      "c-ip": address,
    };

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${prefix}/${faker.string.uuid()}.gz`,
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
   * A visitor count the simulated engine can answer.
   *
   * The shipped one is `count(DISTINCT to_hex(sha256(to_utf8(...))))`, and
   * Yulin has neither the digest nor a distinct count over an expression.
   * KensioSoftware/yulin#1082 is that gap. This counts distinct addresses
   * over the same window and carries the salt where the shipped query carries
   * it, so what these cases cover is the run around the count.
   * `visitor-counts.test.ts` covers who one identifier stands for.
   */
  const aVisitorCount = (): string =>
    `SELECT count(DISTINCT c_ip) AS visitors\n` +
    `  FROM "rainlytics"."cloudfront_logs"\n` +
    `  WHERE ${windowPlaceholder}\n` +
    `    AND ${visitorSaltPlaceholder} <> ''\n`;

  /**
   * A quarter past nine, on both clocks.
   *
   * The job asks the process what time it is, the way it does on Lambda. In
   * the deployed cases the simulated runtime answers, and here the process
   * clock is moved to meet the simulation instead. Only `Date` is replaced,
   * because the Athena poll waits on a real timer.
   */
  const atQuarterPast = async (deployed: Deployed): Promise<void> => {
    const quarterPast = new Date("2026-08-23T09:15:00.000Z");

    vi.useFakeTimers({ toFake: ["Date"], now: quarterPast });
    await deployed.simAws.clock().setTo(quarterPast);
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
    await atQuarterPast(deployed);

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

  it("carries the visitor count where the question asks for one", async () => {
    // Given an hour holding two visits from one address and one from
    // another, and a run that counts visitors as well as views.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, "203.0.113.7");
    await putDelivered(deployed, anHour, "203.0.113.7");
    await putDelivered(deployed, anHour, "198.51.100.24");
    await atQuarterPast(deployed);

    // When the job runs.
    await handler({ ...(aRun() as object), visitorSql: aVisitorCount() });

    // Then the summary carries three views and two visitors, and says that
    // the second number is not one to add to the next day's.
    const summary = await summaryAt(
      deployed,
      "summaries/v1/pageviews/hourly/2026-08-23T08Z.json",
    );

    expect(summary?.rows).toStrictEqual([{ path: "/", views: "3" }]);
    expect(summary?.visitors).toStrictEqual({ distinct: 2, additive: false });
  });

  it("counts nobody for a window that saw nobody", async () => {
    // Given an hour with no traffic at all in it.
    const deployed = await deployAnalytics();
    await atQuarterPast(deployed);

    // When the job runs.
    await handler({ ...(aRun() as object), visitorSql: aVisitorCount() });

    // Then the summary says nobody visited, which is a different answer from
    // a question that counts something else and carries no field at all.
    const summary = await summaryAt(
      deployed,
      "summaries/v1/pageviews/hourly/2026-08-23T08Z.json",
    );

    expect(summary?.visitors).toStrictEqual({ distinct: 0, additive: false });
  });

  it("leaves the field out where the question counts something else", async () => {
    // Given a run carrying no visitor count.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour);
    await atQuarterPast(deployed);

    // When the job runs.
    await handler(aRun());

    // Then the summary has no `visitors` key. Absent and zero are different
    // answers, and a reader can tell them apart.
    const summary = await summaryAt(
      deployed,
      "summaries/v1/pageviews/hourly/2026-08-23T08Z.json",
    );

    expect(summary).not.toHaveProperty("visitors");
  });

  it("fails the run rather than reporting a count Athena did not give", async () => {
    // Given a visitor count over a column the table does not have.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour);
    await atQuarterPast(deployed);

    // When the job runs it.
    const running = handler({
      ...(aRun() as object),
      visitorSql:
        `SELECT count(DISTINCT c_ip) AS nothing\n` +
        `  FROM "rainlytics"."cloudfront_logs"\n` +
        `  WHERE ${windowPlaceholder}\n` +
        `    AND ${visitorSaltPlaceholder} <> ''\n`,
    });

    // Then the run fails and writes no summary. A window full of views
    // reporting no visitors is the failure nobody would see.
    await expect(running).rejects.toThrow(/not a number of visitors/u);
    await expect(
      summaryAt(deployed, "summaries/v1/pageviews/hourly/2026-08-23T08Z.json"),
    ).resolves.toBeUndefined();
  });

  it("fails the run when Athena will not answer the visitor count", async () => {
    // Given a visitor count over a table the catalog does not have.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour);
    await atQuarterPast(deployed);

    // When the job runs it.
    const running = handler({
      ...(aRun() as object),
      visitorSql:
        `SELECT count(DISTINCT c_ip) AS visitors\n` +
        `  FROM "rainlytics"."gone"\n` +
        `  WHERE ${windowPlaceholder}\n` +
        `    AND ${visitorSaltPlaceholder} <> ''\n`,
    });

    // Then the run fails naming the question and writes nothing. The views
    // were counted, and a summary carrying them without the count would say
    // the question had been answered.
    await expect(running).rejects.toThrow(/visitors for pageviews/u);
    await expect(
      summaryAt(deployed, "summaries/v1/pageviews/hourly/2026-08-23T08Z.json"),
    ).resolves.toBeUndefined();
  });

  it("fails the run where the deployment has no salt secret", async () => {
    // Given a deployment pointed at a parameter nobody created.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour);
    await atQuarterPast(deployed);
    vi.stubEnv(summaryEnvironment.visitorSaltParameter, "/nobody/made-this");

    // When the job runs.
    const running = handler({
      ...(aRun() as object),
      visitorSql: aVisitorCount(),
    });

    // Then it fails naming the parameter, before Athena is asked anything.
    await expect(running).rejects.toThrow("/nobody/made-this");
    await expect(
      summaryAt(deployed, "summaries/v1/pageviews/hourly/2026-08-23T08Z.json"),
    ).resolves.toBeUndefined();
  });

  it("fails the run when Athena will not answer the question", async () => {
    // Given a query naming a column the table does not have.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour);
    await atQuarterPast(deployed);

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
