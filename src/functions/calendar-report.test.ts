import {
  assertIdentical,
  assertInstanceOf,
  assertObjectMatches,
  assertStringMatches,
  assertThrowsErrorAsync,
} from "@kensio/smartass";
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
import { describe, it, vi } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { reportQuestions } from "../cdk/report-questions.js";
import { CloudFrontLogDelivery } from "../cdk/log-delivery.js";
import { LogBucket } from "../cdk/log-bucket.js";
import { LogTable } from "../cdk/log-table.js";
import { QueryWorkgroup } from "../cdk/query-workgroup.js";
import { partitionPrefix } from "../partitions.js";
import type { ReportDocument } from "../report-document.js";
import { reportKey } from "../report-key.js";
import { reportPeriod } from "../report-periods.js";
import { cacheHitRatio, pageviews } from "../rollup-questions.js";
import {
  summaryKey,
  summarySchemaVersion,
  type RollupSummary,
} from "../rollup-summaries.js";
import type { SummaryWindow } from "../summary-windows.js";
import { summarySpan } from "../summary-windows.js";
import { defaultVisitorSaltParameter } from "../visitor-identity.js";
import { handler } from "./calendar-report.js";
import type { ReportRun } from "./report-run.js";
import { summaryEnvironment } from "./summary-deployment.js";

describe("one direct run of the calendar report job", () => {
  let intercepted: SimSdk | undefined;

  /** A report deployment with the SDK clients pointed at its simulation. */
  const deployAnalytics = async () => {
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
    const summariesBucketName = `rainlytics-summaries-${faker.string.uuid()}`;
    let run: ReportRun | undefined;

    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "ReportJobStack", {
          env: { account, region: "us-east-1" },
        });
        const logs = new LogBucket(stack, "Logs", {
          bucketName: logBucketName,
        });
        const distribution = new Distribution(stack, "Site", {
          defaultBehavior: { origin: new HttpOrigin("origin.example.com") },
        });
        const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
          distributionId: distribution.distributionId,
          logBucket: logs.bucket,
        });
        const table = new LogTable(stack, "Table", {
          deliveries: [delivery],
        });
        new QueryWorkgroup(stack, "Queries", {
          resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
        });
        new Bucket(stack, "Summaries", {
          bucketName: summariesBucketName,
          removalPolicy: RemovalPolicy.DESTROY,
        });
        new CfnOutput(stack, "DistributionId", {
          value: distribution.distributionId,
        });

        run = {
          timeZone: "UTC",
          weekStartsOn: "tuesday",
          recomputedDays: 1,
          granularities: ["daily"],
          questions: reportQuestions({
            rollups: [pageviews, cacheHitRatio],
            granularities: ["daily"],
            dataset: table.dataset,
          }),
        };
      },
    );

    if (run === undefined) {
      throw new Error("The test stack built no calendar report run.");
    }

    await simAws.region("us-east-1").account().athena().engine().enable();
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

    vi.useRealTimers();
    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(AthenaClient);
    intercepted.intercept(S3Client);
    intercepted.intercept(SSMClient);

    vi.stubEnv(summaryEnvironment.database, "rainlytics");
    vi.stubEnv(summaryEnvironment.workgroup, "rainlytics");
    vi.stubEnv(summaryEnvironment.bucket, summariesBucketName);
    vi.stubEnv(
      summaryEnvironment.visitorSaltParameter,
      defaultVisitorSaltParameter,
    );

    const stack = stacks.get("ReportJobStack");
    if (stack === undefined) {
      throw new Error("The report job stack was not deployed.");
    }

    return {
      simAws,
      run,
      logBucketName,
      summariesBucketName,
      distributionId: stack.output("DistributionId"),
    };
  };

  type Deployed = Awaited<ReturnType<typeof deployAnalytics>>;

  /** One delivered pageview. */
  const aRecord = (
    at: Date,
    address: string,
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
    "c-ip": address,
  });

  /** Puts records into the delivered partition for their day. */
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
          })}/${faker.string.uuid()}.gz`,
          Body: gzipSync(
            records.map((record) => JSON.stringify(record)).join("\n"),
          ),
        },
      });
  };

  /** Reads the daily report this run writes. */
  const readDay = async (deployed: Deployed): Promise<ReportDocument> => {
    const period = reportPeriod(
      {
        unit: "day",
        at: new Date("2026-08-23T12:00:00.000Z"),
        timeZone: "UTC",
      },
      new Date("2026-08-24T00:30:00.000Z"),
    );
    const found = await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .getObject({
        input: {
          Bucket: deployed.summariesBucketName,
          Key: reportKey(period),
        },
      });

    return JSON.parse(
      await text(found.Body as unknown as Readable),
    ) as ReportDocument;
  };

  /** Moves the process and simulation to the report run. */
  const atReportTime = async (deployed: Deployed): Promise<void> => {
    const now = new Date("2026-08-24T00:30:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    await deployed.simAws.clock().setTo(now);
  };

  it("composes summaries, queries raw data and writes the report", async () => {
    // Given one stored pageview summary and the same day's raw logs.
    const deployed = await deployAnalytics();
    const at = new Date("2026-08-23T10:00:00.000Z");
    await putDelivered(deployed, at, [
      aRecord(at, "203.0.113.7"),
      aRecord(new Date("2026-08-23T11:00:00.000Z"), "203.0.113.7"),
      aRecord(new Date("2026-08-23T12:00:00.000Z"), "198.51.100.24"),
    ]);

    const window: SummaryWindow = { granularity: "daily", at };
    const pageviewQuestion = deployed.run.questions[0];
    if (pageviewQuestion === undefined) {
      throw new Error("The report run has no pageviews question.");
    }
    const summary: RollupSummary = {
      schemaVersion: summarySchemaVersion,
      question: pageviewQuestion.question,
      window: summarySpan(window),
      computedAt: "2026-08-24T00:15:00.000Z",
      columns: ["path", "views"],
      rows: [{ path: "/", views: "3" }],
    };
    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.summariesBucketName,
          Key: summaryKey(pageviewQuestion.question, window),
          Body: JSON.stringify(summary),
        },
      });
    await atReportTime(deployed);

    // When the source handler runs with the schedule payload.
    await handler(deployed.run);

    // Then one document combines the stored ranking with exact period
    // queries for visitors and cache totals.
    const report = await readDay(deployed);
    assertIdentical(report.computedAt, "2026-08-24T00:30:00.000Z");
    assertObjectMatches(report.sections[0], {
      accuracy: "exact",
      composition: "single-summary",
      value: { rows: [{ path: "/", views: "3" }] },
    });
    assertObjectMatches(report.sections[1], {
      accuracy: "exact",
      composition: "period-query",
      value: { count: { distinct: 2 } },
    });
    assertObjectMatches(report.sections[2], {
      accuracy: "exact",
      composition: "period-query",
      value: { rows: [{ hits: "3", misses: "0", hit_percent: "100" }] },
    });
  });

  it("writes an unavailable section for an absent or malformed summary", async () => {
    // Given a report with no visitor query and no summary object.
    const deployed = await deployAnalytics();
    const question = deployed.run.questions[0];
    if (question === undefined) {
      throw new Error("The report run has no pageviews question.");
    }
    const run: ReportRun = {
      ...deployed.run,
      questions: [{ ...question, visitorSql: undefined }],
    };
    await atReportTime(deployed);

    // When it runs with no source.
    await handler(run);
    const absentReport = await readDay(deployed);
    assertObjectMatches(absentReport.sections[0], {
      accuracy: "unavailable",
      reason: "incomplete-source",
      value: null,
    });

    const window: SummaryWindow = {
      granularity: "daily",
      at: new Date("2026-08-23T12:00:00.000Z"),
    };
    const summary = {
      schemaVersion: summarySchemaVersion,
      question: question.question,
      window: summarySpan(window),
      computedAt: "2026-08-24T00:15:00.000Z",
      columns: ["path", "views"],
      rows: [{ path: "/", views: "1" }],
    };
    const malformed = [
      null,
      { ...summary, columns: ["path", 4] },
      { ...summary, rows: [null] },
    ];

    // When persisted columns or rows do not match the summary schema.
    for (const candidate of malformed) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await deployed.simAws
        .region("us-east-1")
        .account()
        .s3()
        .putObject({
          input: {
            Bucket: deployed.summariesBucketName,
            Key: summaryKey(question.question, window),
            Body: JSON.stringify(candidate),
          },
        });
      // oxlint-disable-next-line eslint/no-await-in-loop
      await handler(run);

      // Then the malformed source stays visibly incomplete.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const malformedReport = await readDay(deployed);
      assertObjectMatches(malformedReport.sections[0], {
        accuracy: "unavailable",
        reason: "incomplete-source",
        value: null,
      });
    }
  });

  it("closes the store and reports a failed period", async () => {
    // Given a direct-query question whose SQL has no guarded period marker.
    const deployed = await deployAnalytics();
    const question = deployed.run.questions[1];
    if (question === undefined) {
      throw new Error("The report run has no cache question.");
    }
    const run: ReportRun = {
      ...deployed.run,
      questions: [{ ...question, sql: "SELECT 1" }],
    };
    await atReportTime(deployed);

    // Then the invocation fails as a report failure, not as a successful
    // document produced from an unbounded query.
    const error = await assertThrowsErrorAsync(() => handler(run));
    assertInstanceOf(error, AggregateError);
    assertStringMatches(error.message, /1 calendar report/u);
  });
});
