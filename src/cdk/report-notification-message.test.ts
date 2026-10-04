import { assertArrayLength, assertIdentical } from "@kensio/smartass";
import { fileURLToPath } from "node:url";

import { faker } from "@faker-js/faker";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Topic } from "aws-cdk-lib/aws-sns";
import { type App, CfnOutput, Stack } from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import {
  reportDocumentFactory,
  reportNotificationManifestFactory,
} from "#test/report-notification-factories.js";
import { deployStacks } from "#test/simulated-deployment.js";

import { reportNotificationManifestKey } from "../report-notification-manifest.js";
import { previousReportPeriod } from "../report-periods.js";
import { pageviews } from "../rollup-questions.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable } from "./log-table.js";
import { QueryWorkgroup } from "./query-workgroup.js";
import { RollupSummaries } from "./rollup-summaries.js";

describe("a report notification message written by the site", () => {
  it("publishes the site's own text with a figure it read itself", async () => {
    // Given a deployment whose publisher is bundled from the site's own entry,
    // allowed to read a sign-up count the site keeps outside Rainlytics.
    const summariesBucketName = `rainlytics-summaries-${faker.string.uuid()}`;
    const signUps = String(faker.number.int({ min: 1, max: 10_000 }));
    const phoneNumber = `+1555${faker.string.numeric(7)}`;
    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "SiteMessageStack", {
          env: { account, region: "us-east-1" },
        });
        const logs = new LogBucket(stack, "Logs", {
          bucketName: `rainlytics-logs-${faker.string.uuid()}`,
        });
        const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
          distributionId: new Distribution(stack, "Site", {
            defaultBehavior: { origin: new HttpOrigin("origin.example.com") },
          }).distributionId,
          logBucket: logs.bucket,
        });
        const signUpCount = new StringParameter(stack, "SignUps", {
          stringValue: signUps,
        });
        const topic = new Topic(stack, "Reports");
        const summaries = new RollupSummaries(stack, "Summaries", {
          table: new LogTable(stack, "Table", { deliveries: [delivery] }),
          workgroup: new QueryWorkgroup(stack, "Queries", {
            resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
          }),
          rollups: [pageviews],
          granularities: ["daily"],
          summariesBucketName,
          reportNotifications: {
            topic,
            periods: ["day"],
            message: {
              entry: fileURLToPath(
                new URL("../../test/site-report-message.ts", import.meta.url),
              ),
              environment: { SIGN_UPS_PARAMETER: signUpCount.parameterName },
            },
          },
        });
        const publisher = summaries.reportNotifications?.lambda;
        if (publisher === undefined) {
          throw new Error("The deployment created no notification publisher.");
        }
        signUpCount.grantRead(publisher);
        new CfnOutput(stack, "TopicArn", { value: topic.topicArn });
      },
    );
    const account = simAws.region("us-east-1").account();
    const topicArn = stacks.get("SiteMessageStack")?.output("TopicArn");
    await account.sns().subscribe({
      input: { TopicArn: topicArn, Protocol: "sms", Endpoint: phoneNumber },
    });

    // And a closed day whose report and previous report are both stored.
    const manifest = reportNotificationManifestFactory.make();
    const [entry] = manifest.reports;
    if (entry === undefined) {
      throw new Error("The manifest factory produced no report entry.");
    }
    const put = async (key: string, value: unknown) => {
      await account.s3().putObject({
        input: {
          Bucket: summariesBucketName,
          Key: key,
          Body: JSON.stringify(value),
          ContentType: "application/json",
        },
      });
    };
    await put(
      entry.key,
      reportDocumentFactory.make({ period: entry.period, views: 150 }),
    );
    await put(
      entry.previousKey,
      reportDocumentFactory.make({
        period: previousReportPeriod(entry.period),
        views: 100,
      }),
    );

    // When the completion manifest lands and starts the publisher.
    await put(reportNotificationManifestKey(manifest), manifest);
    await simAws.backgroundTasksComplete();

    // Then the topic carries the site's text, its own figure and the default
    // pageviews line it kept, compared against the previous day.
    const messages = account
      .sns()
      .sentSmsMessages()
      .filter((sent) => sent.phoneNumber === phoneNumber);
    assertArrayLength(messages, 1);
    assertIdentical(
      messages[0].message,
      [
        `Sign-ups: ${signUps}`,
        "Day 2026-08-31",
        "  path=/: views 150 pageviews (+50%)",
      ].join("\n"),
    );
  });
});
