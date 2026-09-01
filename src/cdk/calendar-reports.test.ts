import {
  assertArrayLength,
  assertFalse,
  assertIdentical,
  assertObjectEquals,
  assertObjectMatches,
  assertStringIncludes,
  assertStringNotIncludes,
  assertTrue,
} from "@kensio/smartass";
import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { gzipSync } from "node:zlib";

import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Topic } from "aws-cdk-lib/aws-sns";
import { type App, CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { partitionPrefix } from "../partitions.js";
import type { ReportDocument } from "../report-document.js";
import { cacheHitRatio, pageviews } from "../rollup-questions.js";
import { defaultVisitorSaltParameter } from "../visitor-identity.js";
import { rainlyticsCommands } from "../cli/command.js";
import { runCli } from "../cli/run.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable } from "./log-table.js";
import { QueryWorkgroup } from "./query-workgroup.js";
import { RollupSummaries } from "./rollup-summaries.js";

describe("precomputing calendar report documents", () => {
  /** A complete deployed pipeline with one report question. */
  const deployAnalytics = async () => {
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
    const summariesBucketName = `rainlytics-summaries-${faker.string.uuid()}`;
    const notificationNumber = `+1555${faker.string.numeric(7)}`;
    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "ReportStack", {
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
        const workgroup = new QueryWorkgroup(stack, "Queries", {
          resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
        });

        const notificationTopic = new Topic(stack, "ReportNotifications");
        new RollupSummaries(stack, "Summaries", {
          table,
          workgroup,
          rollups: [pageviews, cacheHitRatio],
          granularities: ["daily"],
          summariesBucketName,
          removalPolicy: RemovalPolicy.DESTROY,
          reportNotifications: {
            topic: notificationTopic,
            periods: ["day", "week"],
            subjectPrefix: "Example analytics",
          },
        });

        new CfnOutput(stack, "DistributionId", {
          value: distribution.distributionId,
        });
        new CfnOutput(stack, "NotificationTopicArn", {
          value: notificationTopic.topicArn,
        });
      },
    );

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

    const stack = stacks.get("ReportStack");
    if (stack === undefined) {
      throw new Error("The calendar report stack was not deployed.");
    }

    const notificationTopicArn = stack.output("NotificationTopicArn");
    await simAws
      .region("us-east-1")
      .account()
      .sns()
      .subscribe({
        input: {
          TopicArn: notificationTopicArn,
          Protocol: "sms",
          Endpoint: notificationNumber,
        },
      });

    return {
      simAws,
      logBucketName,
      summariesBucketName,
      distributionId: stack.output("DistributionId"),
      notificationTopicArn,
      notificationNumber,
    };
  };

  type Deployed = Awaited<ReturnType<typeof deployAnalytics>>;

  /** One pageview-shaped delivered record. */
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

  /** Delivers records into the partition holding their first instant. */
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

  /** Reads a report document from the summaries bucket. */
  const reportAt = async (
    deployed: Deployed,
    key: string,
  ): Promise<ReportDocument> => {
    const found = await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .getObject({
        input: { Bucket: deployed.summariesBucketName, Key: key },
      });

    return JSON.parse(
      await text(found.Body as unknown as Readable),
    ) as ReportDocument;
  };

  it("writes, replaces and reads a closed report through the command line", async () => {
    // Given two visitors making three pageviews on Sunday 23 August.
    const deployed = await deployAnalytics();
    const at = new Date("2026-08-23T10:00:00.000Z");
    const returning = "203.0.113.7";
    await putDelivered(deployed, at, [
      aRecord(at, returning),
      aRecord(new Date("2026-08-23T11:00:00.000Z"), returning),
      aRecord(new Date("2026-08-23T12:00:00.000Z"), "198.51.100.24"),
    ]);

    // When the daily summary and report schedules have both fired.
    await deployed.simAws.clock().advanceBy({ hours: 15, minutes: 31 });
    await deployed.simAws.backgroundTasksComplete();

    // Then the day has exact rows from its daily summary and an exact
    // period-wide visitor query.
    const dayKey = "reports/v1/UTC/day/2026-08-23.json";
    const first = await reportAt(deployed, dayKey);
    assertTrue(first.sourceCoverage?.complete);
    assertObjectMatches(first.sections[0], {
      accuracy: "exact",
      composition: "single-summary",
      value: { rows: [{ path: "/", views: "3" }] },
    });
    assertObjectMatches(first.sections[1], {
      accuracy: "exact",
      composition: "period-query",
      value: {
        type: "visitor-count",
        count: { distinct: 2, additive: false },
      },
    });
    assertObjectMatches(first.sections[2], {
      accuracy: "exact",
      composition: "period-query",
      source: { summaries: 0, queries: 1, complete: true },
      value: {
        type: "rows",
        rows: [{ hits: "3", misses: "0", hit_percent: "100" }],
      },
    });

    // And one digest covers both report periods that closed on this local
    // day. SMS is a simulated subscriber used to inspect the plain SNS body.
    const firstNotifications = deployed.simAws
      .region("us-east-1")
      .account()
      .sns()
      .sentSmsMessages();
    assertArrayLength(firstNotifications, 1);
    const firstNotification = firstNotifications[0];
    assertIdentical(firstNotification.phoneNumber, deployed.notificationNumber);
    assertStringIncludes(firstNotification.message, "Day 2026-08-23");
    assertStringIncludes(
      firstNotification.message,
      "Week 2026-08-17 to 2026-08-23",
    );
    assertStringIncludes(firstNotification.message, "views 3 pageviews");

    // And the Monday-first week that closed on the same boundary exists but
    // exposes its missing earlier daily summaries.
    const week = await reportAt(
      deployed,
      "reports/v1/UTC/week/monday/2026-08-17.json",
    );
    assertFalse(week.sourceCoverage?.complete);
    assertObjectMatches(week.sections[0], {
      accuracy: "unavailable",
      reason: "incomplete-source",
      value: null,
    });

    // When a fourth view arrives after that report and the next daily runs
    // recompute both the source summary and its report.
    await putDelivered(deployed, at, [
      aRecord(new Date("2026-08-23T18:00:00.000Z"), returning),
    ]);
    await deployed.simAws.clock().advanceBy({ hours: 24 });
    await deployed.simAws.backgroundTasksComplete();

    // Then the same key holds the replacement document with the late view.
    const replaced = await reportAt(deployed, dayKey);
    assertObjectMatches(replaced.sections[0], {
      value: { rows: [{ path: "/", views: "4" }] },
    });
    assertObjectMatches(replaced.sections[1], {
      value: { count: { distinct: 2 } },
    });
    assertObjectEquals(replaced.period, first.period);
    assertIdentical(replaced.computedAt, "2026-08-25T00:30:00.000Z");

    // And the next local day produces one new digest, despite recomputing the
    // prior day report at the same deterministic report key.
    const secondNotifications = deployed.simAws
      .region("us-east-1")
      .account()
      .sns()
      .sentSmsMessages();
    assertArrayLength(secondNotifications, 2);

    // When the command reads the report through the SDK as a caller would.
    using simSdk = new SimSdk({ simAws: deployed.simAws });
    simSdk.intercept(S3Client);
    let stdout = "";
    let stderr = "";
    const code = await runCli({
      argv: [
        "report",
        "day",
        "2026-08-23",
        "--summaries",
        deployed.summariesBucketName,
        "--region",
        "us-east-1",
      ],
      commands: rainlyticsCommands,
      io: {
        out: (written) => {
          stdout += written;
        },
        error: (written) => {
          stderr += written;
        },
        outIsTerminal: false,
      },
    });

    // Then standard output preserves the document the producer stored.
    // Standard error carries the S3 diagnostic and no Athena query report.
    assertIdentical(code, 0);
    assertObjectEquals(JSON.parse(stdout), replaced);
    assertStringIncludes(stderr, deployed.summariesBucketName);
    assertStringIncludes(stderr, "1 GET");
    assertStringIncludes(stderr, "ago");
    assertStringNotIncludes(stderr, "Query ");
    assertStringNotIncludes(stderr, "Scanned");
  });
});
