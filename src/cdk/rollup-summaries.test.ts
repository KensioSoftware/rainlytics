import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { gzipSync } from "node:zlib";

import { faker } from "@faker-js/faker";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  type App,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
} from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks, simStartedAt } from "#test/simulated-deployment.js";

import { summaryEnvironment } from "../functions/summary-deployment.js";
import { partitionPrefix } from "../partitions.js";
import { pageviews } from "../rollup-questions.js";
import type { RollupSummary } from "../rollup-summaries.js";
import { summarySchemaVersion } from "../rollup-summaries.js";
import type { Rollup } from "../rollups.js";
import { defaultRedirectStatuses, windowPlaceholder } from "../rollups.js";
import {
  defaultVisitorSaltParameter,
  visitorSaltPlaceholder,
} from "../visitor-identity.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable } from "./log-table.js";
import { QueryWorkgroup } from "./query-workgroup.js";
import { RollupSummaries } from "./rollup-summaries.js";
import type { RollupSummariesProps } from "./summary-configuration.js";

describe("computing rollup summaries on a schedule", () => {
  /**
   * The hour the traffic in these cases happened in.
   *
   * The simulation starts at 09:00 and the schedules fire at fifteen minutes
   * past, so the newest closed hour a run meets is the one before it.
   */
  const theClosedHour = new Date("2026-08-23T08:00:00.000Z");

  /**
   * The pageviews question with its visitor count turned off.
   *
   * Every case here is about windows, keys, buckets and lag, and a visitor
   * count in the middle of them would be a second query nothing can answer.
   * Yulin's Athena engine has no `sha256`, `to_utf8` or `to_hex`, so the
   * shipped count comes back empty under a SUCCEEDED state and the run
   * refuses it. KensioSoftware/yulin#1082 is that gap, and the two cases
   * below cover the wiring that reaches it.
   */
  const viewsOnly: Rollup = { ...pageviews, countsVisitors: false };

  /** A whole deployment in a simulated account, computing one question. */
  const deployAnalytics = async (
    over: Partial<RollupSummariesProps> = {},
    inStack: (stack: Stack) => Partial<RollupSummariesProps> = () => ({}),
  ) => {
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
          rollups: [viewsOnly],
          granularities: ["hourly"],
          summariesBucketName,
          removalPolicy: RemovalPolicy.DESTROY,
          ...inStack(stack),
          ...over,
        });
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();

    // The salt secret, put where a site's operator puts it. Nothing in the
    // stack creates it, because CloudFormation writes no SecureString and a
    // secret in a template is not one. `docs/visitors/` has the command.
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

  /** The rows one summary holds, or nothing where none was written. */
  const rowsIn = async (
    deployed: Deployed,
    key: string,
  ): Promise<RollupSummary["rows"] | undefined> => {
    const summary = await summaryAt(deployed, key);

    return summary?.rows;
  };

  /*
   * The keys the summaries land under, written out here from
   * `docs/summaries/` rather than built with `summaryKey`. A test that asked
   * the code where it had put something would pass whatever the code decided,
   * and the layout is a promise to whatever reads the bucket next.
   */
  const closedHourKey = "summaries/v1/pageviews/hourly/2026-08-23T08Z.json";
  const hourBeforeKey = "summaries/v1/pageviews/hourly/2026-08-23T07Z.json";
  const closedDayKey = "summaries/v1/pageviews/daily/2026-08-23.json";

  it("writes the closed hour to the bucket when the schedule fires", async () => {
    // Given an hour of traffic holding two views of the home page and one of
    // a second page, delivered under the hour that has since closed.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, theClosedHour, [
      aRecord(theClosedHour),
      aRecord(theClosedHour),
      aRecord(theClosedHour, { "cs-uri-stem": "/grammar/" }),
    ]);

    // When the clock reaches the first firing of the hourly schedule.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the hour is in the bucket, under the key the schema builds, with
    // the rows the question answered.
    const summary = await summaryAt(deployed, closedHourKey);

    expect(summary?.window).toStrictEqual({
      granularity: "hourly",
      from: "2026-08-23T08:00:00.000Z",
      until: "2026-08-23T09:00:00.000Z",
    });
    expect(summary?.columns).toStrictEqual(["path", "views"]);
    expect(summary?.rows).toStrictEqual([
      { path: "/", views: "2" },
      { path: "/grammar/", views: "1" },
    ]);
  });

  it("records the question the summary answers", async () => {
    // Given an hour of traffic under a question narrowed to one host.
    const deployed = await deployAnalytics({
      requests: { pageviews: { host: "www.example.com", limit: 5 } },
    });
    await putDelivered(deployed, theClosedHour, [aRecord(theClosedHour)]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the document says what it counted, so a reader asking a wider
    // question can see that this answer is a narrower one.
    const summary = await summaryAt(deployed, closedHourKey);

    expect(summary?.schemaVersion).toBe(summarySchemaVersion);
    expect(summary?.question).toStrictEqual({
      name: "pageviews",
      host: "www.example.com",
      includeBots: false,
      limit: 5,
      param: "q",
      redirectStatuses: defaultRedirectStatuses,
    });
    expect(summary?.computedAt).toBe("2026-08-23T09:15:00.000Z");
  });

  it("writes an empty answer for a window that saw no traffic", async () => {
    // Given traffic in the hour before the one that has just closed, and
    // none in the closed hour itself.
    const deployed = await deployAnalytics();
    const hourBefore = new Date("2026-08-23T07:30:00.000Z");
    await putDelivered(deployed, hourBefore, [aRecord(hourBefore)]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then both hours have a summary, and the quiet one holds no rows. A
    // window nobody computed is no object at all, and a reader has to be able
    // to tell the two apart.
    await expect(rowsIn(deployed, hourBeforeKey)).resolves.toStrictEqual([
      { path: "/", views: "1" },
    ]);

    const quiet = await summaryAt(deployed, closedHourKey);

    expect(quiet?.rows).toStrictEqual([]);
    expect(quiet?.columns).toStrictEqual(["path", "views"]);
  });

  it("picks up a record that arrived after its window was computed", async () => {
    // Given an hour computed with two of its records delivered.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, theClosedHour, [
      aRecord(theClosedHour),
      aRecord(theClosedHour),
    ]);
    await deployed.simAws.clock().advanceBy({ minutes: 16 });
    await expect(rowsIn(deployed, closedHourKey)).resolves.toStrictEqual([
      { path: "/", views: "2" },
    ]);

    // When a third record for that hour is delivered late, and the next run
    // happens.
    await putDelivered(deployed, new Date("2026-08-23T08:45:00.000Z"), [
      aRecord(theClosedHour),
    ]);
    await deployed.simAws.clock().advanceBy({ hours: 1 });

    // Then the hour is recomputed and counts it. A run that only ever wrote
    // the window that had just closed would have left this record out for as
    // long as the summary lived.
    await expect(rowsIn(deployed, closedHourKey)).resolves.toStrictEqual([
      { path: "/", views: "3" },
    ]);
  });

  it("computes the day that closed on the daily cadence", async () => {
    // Given a day of traffic, and a deployment computing days.
    const deployed = await deployAnalytics({ granularities: ["daily"] });
    await putDelivered(deployed, theClosedHour, [
      aRecord(theClosedHour),
      aRecord(new Date("2026-08-23T21:00:00.000Z"), {
        "cs-uri-stem": "/grammar/",
      }),
    ]);

    // When the clock reaches the first firing after midnight UTC.
    await deployed.simAws.clock().advanceBy({ hours: 15, minutes: 16 });

    // Then the day is in the bucket, counted from raw rather than added up
    // out of its hours.
    const summary = await summaryAt(deployed, closedDayKey);

    expect(summary?.window).toStrictEqual({
      granularity: "daily",
      from: "2026-08-23T00:00:00.000Z",
      until: "2026-08-24T00:00:00.000Z",
    });
    expect(summary?.rows).toStrictEqual([
      { path: "/", views: "1" },
      { path: "/grammar/", views: "1" },
    ]);
  });

  it("computes one window on a lag a site chose", async () => {
    // Given a site that watched its own delivery, wants a shorter lag, and
    // is content to compute each hour once.
    const deployed = await deployAnalytics({
      lag: Duration.minutes(5),
      recomputedWindows: 1,
      timeout: Duration.minutes(2),
      logRetention: RetentionDays.ONE_WEEK,
    });
    const hourBefore = new Date("2026-08-23T07:30:00.000Z");

    await putDelivered(deployed, theClosedHour, [aRecord(theClosedHour)]);
    await putDelivered(deployed, hourBefore, [aRecord(hourBefore)]);

    // When the clock reaches five minutes past the hour.
    await deployed.simAws.clock().advanceBy({ minutes: 6 });

    // Then the hour that closed is there and the one before it was left
    // alone. No object at all is a window nobody computed, and it reads
    // differently from a window that saw no traffic.
    await expect(rowsIn(deployed, closedHourKey)).resolves.toStrictEqual([
      { path: "/", views: "1" },
    ]);
    await expect(summaryAt(deployed, hourBeforeKey)).resolves.toBeUndefined();
  });

  it("writes into a bucket the site brought with it", async () => {
    // Given a site that keeps its summaries in a bucket of its own, so that
    // something outside this stack can be given read access to them.
    const ownBucketName = `mine-${faker.string.uuid()}`;
    const deployed = await deployAnalytics({}, (stack) => ({
      summariesBucket: new Bucket(stack, "Mine", {
        bucketName: ownBucketName,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    }));

    await putDelivered(deployed, theClosedHour, [aRecord(theClosedHour)]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the summary lands in that bucket, under the same key.
    const found = await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .getObject({ input: { Bucket: ownBucketName, Key: closedHourKey } });

    expect(
      JSON.parse(await text(found.Body as unknown as Readable)),
    ).toMatchObject({
      rows: [{ path: "/", views: "1" }],
    });
  });

  it("hands the visitor count to the schedule without the salt", async () => {
    // Given a deployment of the question as Rainlytics ships it, which counts
    // visitors.
    const deployed = await deployAnalytics({ rollups: [pageviews] });

    // When the schedule's target input is read back.
    const schedule = await deployed.simAws
      .region("us-east-1")
      .account()
      .scheduler()
      .getSchedule({ input: { Name: "rainlytics-pageviews-hourly" } });
    const input = String(schedule.Target?.Input);

    // Then it carries the count and neither the window nor the salt. Both
    // arrive when the run happens, which is what keeps a salt out of the
    // schedule and out of the CloudFormation template holding it.
    expect(input).toContain("visitorSql");
    expect(input).toContain(windowPlaceholder);
    expect(input).toContain(visitorSaltPlaceholder);
  });

  it("tells the job which parameter the salt is in", async () => {
    // Given a site that keeps its secret under a name of its own.
    const parameter = `/mine/${faker.string.uuid()}`;
    const deployed = await deployAnalytics({ visitorSaltParameter: parameter });
    const lambda = deployed.simAws.region("us-east-1").account().lambda();
    const functions = await lambda.listFunctions({ input: {} });

    // Then the deployed function reads that one. A deployment that named
    // none would count visitors under a salt it invented.
    const found = await lambda.getFunction({
      input: { FunctionName: String(functions.Functions[0]?.FunctionName) },
    });

    expect(found.Configuration.Environment?.Variables).toMatchObject({
      [summaryEnvironment.visitorSaltParameter]: parameter,
    });
  });

  it("names the default parameter where a site chose none", async () => {
    // Given a deployment that said nothing about where its secret lives.
    const deployed = await deployAnalytics();
    const lambda = deployed.simAws.region("us-east-1").account().lambda();
    const functions = await lambda.listFunctions({ input: {} });

    // Then it reads the one `docs/visitors/` tells an operator to create.
    const found = await lambda.getFunction({
      input: { FunctionName: String(functions.Functions[0]?.FunctionName) },
    });

    expect(found.Configuration.Environment?.Variables).toMatchObject({
      [summaryEnvironment.visitorSaltParameter]: defaultVisitorSaltParameter,
    });
  });

  it("starts from the instant the simulation does", () => {
    // Given nothing but the fixed clock these cases count their hours from.
    // Then the windows written out above are the ones a run would meet.
    expect(simStartedAt.toISOString()).toBe("2026-08-23T09:00:00.000Z");
  });
});
