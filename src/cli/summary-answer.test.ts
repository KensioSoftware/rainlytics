import { gzipSync } from "node:zlib";

import { AthenaClient } from "@aws-sdk/client-athena";
import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { type App, CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib/core";
import { describe, expect, it, vi } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { CloudFrontLogDelivery } from "../cdk/log-delivery.js";
import { LogBucket } from "../cdk/log-bucket.js";
import { LogTable } from "../cdk/log-table.js";
import { QueryWorkgroup } from "../cdk/query-workgroup.js";
import { RollupSummaries } from "../cdk/rollup-summaries.js";
import type { RollupSummariesProps } from "../cdk/summary-configuration.js";
import { partitionPrefix } from "../partitions.js";
import { cacheHitRatio, pageviews } from "../rollup-questions.js";
import { rainlyticsCommands } from "./command.js";
import { runCli } from "./run.js";

/*
 * A named question answered out of the bucket a schedule wrote to, driven
 * through the real command line.
 *
 * The summaries are computed by the deployed `RollupSummaries` construct
 * rather than written here. The producer and the reader are the two halves
 * `rollup-summaries.ts` exists to keep in step, and a case putting documents
 * in the bucket by hand would prove the reader agrees with the test instead.
 */
describe("the named questions, answered from stored summaries", () => {
  let intercepted: SimSdk | undefined;

  /** The hour the traffic in these cases happened in. */
  const anHour = new Date("2026-08-23T08:00:00.000Z");

  /** The hour before it. */
  const hourBefore = new Date("2026-08-23T07:00:00.000Z");

  /**
   * When the command runs, being a minute after the first schedule fired.
   *
   * The simulation starts at 09:00 and the hourly schedules fire a quarter
   * past, so a run at 09:16 meets the two hours that have just been computed.
   */
  const afterTheRun = new Date("2026-08-23T09:16:00.000Z");

  /** The whole pipeline in a simulated account, summaries included. */
  const deployAnalytics = async (over: Partial<RollupSummariesProps> = {}) => {
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
          rollups: [pageviews, cacheHitRatio],
          granularities: ["hourly"],
          summariesBucketName,
          removalPolicy: RemovalPolicy.DESTROY,
          ...over,
        });
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();

    // What the previous case replaced, put back before this one replaces it
    // again. Only `Date` is faked, because `--last` is measured from the
    // process clock and the Athena poll waits on a real timer.
    vi.useRealTimers();
    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(AthenaClient);
    intercepted.intercept(S3Client);

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

  /** One record, with everything a rollup reads set to something sensible. */
  const aRecord = (
    at: Date,
    over: Readonly<Record<string, string>> = {},
  ): Readonly<Record<string, string>> => ({
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
    ...over,
  });

  /** One delivered object holding these records. */
  const putDelivered = async (
    deployed: Deployed,
    at: Date,
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
            at,
          })}/${String(at.getTime())}.gz`,
          Body: gzipSync(
            records.map((record) => JSON.stringify(record)).join("\n"),
          ),
        },
      });
  };

  /** Runs the schedules that have fired by a quarter past nine. */
  const untilTheScheduleFires = async (deployed: Deployed): Promise<void> => {
    await deployed.simAws.clock().advanceBy({ minutes: 16 });
    vi.useFakeTimers({ toFake: ["Date"], now: afterTheRun });
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

  it("answers one hour out of the bucket without touching Athena", async () => {
    // Given an hour of traffic that a schedule has since computed.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, [
      aRecord(anHour),
      aRecord(anHour),
      aRecord(anHour, { "cs-uri-stem": "/grammar/" }),
    ]);
    await untilTheScheduleFires(deployed);

    // When the pageviews of the hour that closed are asked for. Two hours
    // back from 09:16 covers the whole hour opening at 08:00 and nothing
    // else.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then the rows are the ones the schedule stored, and standard error
    // says a GET answered rather than a query.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      { path: "/", views: "2" },
      { path: "/grammar/", views: "1" },
    ]);
    expect(run.error).toContain(deployed.summariesBucketName);
    expect(run.error).toContain("1 GET");
    expect(run.error).not.toContain("Scanned");
  });

  it("says how old the answer is and what reading it cost", async () => {
    // Given the same computed hour.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, [aRecord(anHour)]);
    await untilTheScheduleFires(deployed);

    // When it is read.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then standard error carries the span it covers and how far behind the
    // scheduled run it is. A person comparing this figure against something
    // else has to know both.
    expect(run.error).toContain("2026-08-23T08:00:00.000Z");
    expect(run.error).toContain("2026-08-23T09:00:00.000Z");
    expect(run.error).toContain("computed 2026-08-23T09:15:00.000Z");
    expect(run.error).toContain("1 minute ago");
  });

  it("adds two windows up and says the ranking is approximate", async () => {
    // Given two hours of traffic, both computed, in which one page was
    // looked at in both.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, hourBefore, [
      aRecord(hourBefore, { "cs-uri-stem": "/grammar/" }),
      aRecord(hourBefore, { "cs-uri-stem": "/grammar/" }),
    ]);
    await putDelivered(deployed, anHour, [
      aRecord(anHour),
      aRecord(anHour, { "cs-uri-stem": "/grammar/" }),
    ]);
    await untilTheScheduleFires(deployed);

    // When three hours back are asked for, covering both stored hours.
    const run = await cli([
      "pageviews",
      "--last",
      "3h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then the page looked at in both hours carries all three views and
    // leads the answer, and standard error says what an assembled ranking
    // leaves out.
    expect(run.rows).toStrictEqual([
      { path: "/grammar/", views: "3" },
      { path: "/", views: "1" },
    ]);
    expect(run.error).toContain("ranking is approximate");
  });

  it("works the cache percentage out again over two windows", async () => {
    // Given two computed hours, one served entirely from cache and one that
    // missed half the time.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, hourBefore, [
      aRecord(hourBefore),
      aRecord(hourBefore),
    ]);
    await putDelivered(deployed, anHour, [
      aRecord(anHour),
      aRecord(anHour, { "x-edge-result-type": "Miss" }),
    ]);
    await untilTheScheduleFires(deployed);

    // When the ratio over both is asked for.
    const run = await cli([
      "cache-hit-ratio",
      "--last",
      "3h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then it is three hits in four decided requests. Averaging the two
    // stored percentages would have answered 87.5, which is a figure about
    // neither hour.
    expect(run.rows).toStrictEqual([
      { hits: "3", misses: "1", hit_percent: "75.0" },
    ]);
  });

  it("tells a quiet window from one nobody computed", async () => {
    // Given traffic in the older hour and none in the newer one. The job
    // writes a document holding no rows for the quiet hour.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, hourBefore, [aRecord(hourBefore)]);
    await untilTheScheduleFires(deployed);

    // When both hours are asked about.
    const run = await cli([
      "pageviews",
      "--last",
      "3h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then the answer is the traffic that happened, over both windows. A
    // run that had skipped writing the quiet hour would have left a hole
    // here and stopped the command.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([{ path: "/", views: "1" }]);
  });

  it("answers the same rows whichever way it was asked", async () => {
    // Given an hour of traffic that a schedule has computed.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, [
      aRecord(anHour),
      aRecord(anHour, { "cs-uri-stem": "/grammar/" }),
    ]);
    await untilTheScheduleFires(deployed);

    // When the same hour is read from the bucket and then queried.
    const stored = await cli([
      "pageviews",
      "--last",
      "2h",
      "--summaries",
      deployed.summariesBucketName,
    ]);
    const queried = await cli(["pageviews", "--query", "--last", "2h"]);

    // Then the rows are the same. A pipeline reading the JSON sees no
    // difference, and the difference between the two is on standard error.
    expect(stored.rows).toStrictEqual(queried.rows);
    expect(queried.error).toContain("Scanned");
  });

  it("says where to look when nothing has named a bucket", async () => {
    // Given a deployment nobody told the command about.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, [aRecord(anHour)]);
    await untilTheScheduleFires(deployed);

    // When a question is asked with no bucket on the line or in the
    // environment.
    vi.stubEnv("RAINLYTICS_SUMMARY_BUCKET", "");
    const run = await cli(["pageviews", "--last", "2h"]);

    // Then it says what to do and exits as the command-line mistake it is.
    // Falling back to a query would have put the cost back without anybody
    // choosing it.
    expect(run.code).toBe(2);
    expect(run.error).toContain("--summaries");
    expect(run.error).toContain("RAINLYTICS_SUMMARY_BUCKET");
    expect(run.error).toContain("--query");
  });

  it("reads the bucket the environment names", async () => {
    // Given the bucket in the environment instead of on the line, the way a
    // shell profile would set it.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, [aRecord(anHour)]);
    await untilTheScheduleFires(deployed);
    vi.stubEnv("RAINLYTICS_SUMMARY_BUCKET", deployed.summariesBucketName);

    // When the question is asked with no --summaries.
    const run = await cli(["pageviews", "--last", "2h"]);

    // Then it is answered. That is the same variable RollupSummaries sets on
    // its own job, so one name covers both halves.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([{ path: "/", views: "1" }]);
  });

  it("says so where no window in the span has been computed", async () => {
    // Given a deployment whose schedules have never fired.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, [aRecord(anHour)]);
    vi.useFakeTimers({ toFake: ["Date"], now: afterTheRun });

    // When two hours of it are asked for.
    const run = await cli([
      "pageviews",
      "--last",
      "3h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then it says nothing has computed those windows and offers the query.
    // "Nobody has computed this" is a different answer from "nothing
    // happened", and the command has to be able to say which.
    expect(run.code).toBe(1);
    expect(run.error).toContain("No summary covers");
    expect(run.error).toContain("--query");
  });

  it("refuses a span holding no whole stored window", async () => {
    // Given a computed hour, asked about over the hour that is still
    // filling.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, [aRecord(anHour)]);
    await untilTheScheduleFires(deployed);

    // When one hour back from 09:16 is asked for, which falls inside the
    // hour opening at 08:00 and covers none of it.
    const run = await cli([
      "pageviews",
      "--last",
      "1h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then it says the span holds no stored window, as a command-line
    // mistake rather than as a run that failed.
    expect(run.code).toBe(2);
    expect(run.error).toContain("no whole stored window");
  });

  it("refuses filters the stored summaries were not computed with", async () => {
    // Given a deployment computing the whole distribution, which is what
    // RollupSummaries does where nobody narrows it.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, anHour, [aRecord(anHour)]);
    await untilTheScheduleFires(deployed);

    // When one section of the site is asked about.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--path",
      "/grammar/",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then it names the difference and offers the query. Answering out of
    // the unfiltered summary would have reported the whole site under a
    // command line naming one section of it.
    expect(run.code).toBe(1);
    expect(run.error).toContain("answer a different question");
    expect(run.error).toContain("--path");
    expect(run.error).toContain("the whole distribution");
    expect(run.error).toContain("--query");
  });

  it("answers a narrowed question the deployment precomputed", async () => {
    // Given a deployment that computes pageviews under one section, which
    // is what the requests prop is for.
    const deployed = await deployAnalytics({
      requests: { pageviews: { paths: ["/grammar/"] } },
    });
    await putDelivered(deployed, anHour, [
      aRecord(anHour),
      aRecord(anHour, { "cs-uri-stem": "/grammar/" }),
    ]);
    await untilTheScheduleFires(deployed);

    // When the same narrowing is asked for.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--path",
      "/grammar/",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then it is answered from the bucket. The filters a schedule was given
    // are what a run has to match, and this one does.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([{ path: "/grammar/", views: "1" }]);
  });

  it("takes the top rows of a summary computed with room to spare", async () => {
    // Given a deployment computing the top hundred paths.
    const deployed = await deployAnalytics({
      requests: { pageviews: { limit: 100 } },
    });
    await putDelivered(deployed, anHour, [
      aRecord(anHour),
      aRecord(anHour),
      aRecord(anHour, { "cs-uri-stem": "/grammar/" }),
    ]);
    await untilTheScheduleFires(deployed);

    // When a run asks for the top one.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--limit",
      "1",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then the stored answer covers it. The top one of a stored hundred is
    // the top one, and refusing it would send a default row count to Athena
    // for an answer already sitting in the bucket.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([{ path: "/", views: "2" }]);
  });

  it("ignores a row count on a question with one row", async () => {
    // Given a deployment that set a row count on the ratio, which answers
    // one row and takes no --limit at the command line.
    const deployed = await deployAnalytics({
      requests: { "cache-hit-ratio": { limit: 5 } },
    });
    await putDelivered(deployed, anHour, [aRecord(anHour)]);
    await untilTheScheduleFires(deployed);

    // When the ratio is asked for, at the default row count of twenty.
    const run = await cli([
      "cache-hit-ratio",
      "--last",
      "2h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then it is answered. A row count decides how much of a ranked answer
    // is printed, and this question has nothing to rank.
    //
    // The percentage is read as a number, the way the query cases read it.
    // One stored window is passed through exactly as the query wrote it, and
    // how many decimal places that carries is Athena's business.
    const [ratio] = run.rows as Readonly<Record<string, string>>[];

    expect(run.code).toBe(0);
    expect(ratio?.["hits"]).toBe("1");
    expect(ratio?.["misses"]).toBe("0");
    expect(Number(ratio?.["hit_percent"])).toBe(100);
  });

  it("refuses a row count the stored summary cannot reach", async () => {
    // Given a deployment computing the top row alone.
    const deployed = await deployAnalytics({
      requests: { pageviews: { limit: 1 } },
    });
    await putDelivered(deployed, anHour, [aRecord(anHour)]);
    await untilTheScheduleFires(deployed);

    // When a run asks for twenty.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--summaries",
      deployed.summariesBucketName,
    ]);

    // Then it says so. Nineteen rows nobody counted cannot be recovered from
    // a stored answer holding one.
    expect(run.code).toBe(1);
    expect(run.error).toContain("--limit");
  });
});
