import {
  assertArrayLength,
  assertIdentical,
  assertStringIncludes,
  assertThrowsError,
  assertTrue,
  assertUndefined,
} from "@kensio/smartass";

import { faker } from "@faker-js/faker";
import { Match, Template } from "aws-cdk-lib/assertions";
import { App, Stack } from "aws-cdk-lib/core";
import { Topic } from "aws-cdk-lib/aws-sns";
import { describe, it } from "vitest";

import { pageviews } from "../rollup-questions.js";
import { reportNotificationEnvironment } from "../functions/report-notification-deployment.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable } from "./log-table.js";
import { QueryWorkgroup } from "./query-workgroup.js";
import { reportNotificationConfiguration } from "./report-notification-configuration.js";
import { reportNotificationLambdaEnvironment } from "./report-notification-environment.js";
import {
  assertReportNotificationQuestions,
  configuredReportNotifications,
} from "./report-notification-setup.js";
import { RollupSummaries } from "./rollup-summaries.js";

describe("calendar report notification infrastructure", () => {
  const summariesWithEmail = (email: string) => {
    const stack = new Stack(new App(), "NotificationsStack", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    const logs = new LogBucket(stack, "Logs", {
      bucketName: `rainlytics-logs-${faker.string.uuid()}`,
    });
    const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
      distributionId: "E1EXAMPLE1234",
      logBucket: logs.bucket,
    });
    const table = new LogTable(stack, "Table", { deliveries: [delivery] });
    const workgroup = new QueryWorkgroup(stack, "Queries", {
      resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
    });
    const summaries = new RollupSummaries(stack, "Summaries", {
      table,
      workgroup,
      rollups: [pageviews],
      granularities: ["daily"],
      summariesBucketName: `rainlytics-summaries-${faker.string.uuid()}`,
      reportNotifications: { emails: [email], periods: ["day", "month"] },
    });

    return { stack, summaries };
  };

  it("subscribes configured addresses to plain-text SNS email", () => {
    // Given one address configured for report notifications.
    const email = `${faker.string.alphanumeric(12)}@example.com`;

    // When the deployment is synthesised.
    const { stack, summaries } = summariesWithEmail(email);
    const template = Template.fromStack(stack);

    // Then SNS uses the email protocol, which sends the published message as
    // plain text. The email-json protocol would expose the SNS envelope.
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: email,
    });
    template.resourceCountIs("AWS::SNS::Topic", 1);
    assertTrue(summaries.reportNotifications?.topic !== undefined);
  });

  it("installs an S3 Object-created filter for completion manifests", () => {
    // Given notifications on a construct-owned summaries bucket.
    const { stack } = summariesWithEmail("reports@example.com");

    // When the bucket notification custom resource is read from the template.
    const resources = Template.fromStack(stack).findResources(
      "Custom::S3BucketNotifications",
    );
    const serialized = JSON.stringify(resources);

    // Then only JSON completion manifests can invoke the publisher function.
    assertStringIncludes(serialized, "s3:ObjectCreated:Put");
    assertStringIncludes(serialized, "report-notifications/v1/");
    assertStringIncludes(serialized, ".json");
    Template.fromStack(stack).hasResourceProperties(
      "AWS::Lambda::Permission",
      Match.objectLike({ Principal: "s3.amazonaws.com" }),
    );
  });

  it("requires a topic or an email subscription", () => {
    // Given an empty notification configuration.
    // When it is settled at synthesis.
    const settling = () => reportNotificationConfiguration({});

    // Then the deployment fails before creating an unused topic.
    const error = assertThrowsError(settling);
    assertStringIncludes(error.message, "SNS topic or at least one email");
  });

  it("refuses a question absent from the report deployment", () => {
    // Given one notification question that no configured rollup computes.
    const configuration = reportNotificationConfiguration({
      emails: ["reports@example.com"],
      questions: ["missing-question"],
    });

    // When it is checked against the deployed report questions.
    const checking = () => {
      assertReportNotificationQuestions(configuration, ["pageviews"]);
    };

    // Then synthesis refuses a digest that would contain no matching data.
    const error = assertThrowsError(checking);
    assertStringIncludes(error.message, "missing-question");
    assertStringIncludes(error.message, "not computed");
  });

  it("defaults a valid topic configuration and accepts its questions", () => {
    // Given a standard topic and no optional notification settings.
    const stack = new Stack(new App(), "ExistingTopicStack");
    const topic = new Topic(stack, "Topic");

    // When its settings are settled against the available questions.
    const configuration = configuredReportNotifications({ topic }, [
      "pageviews",
    ]);
    if (configuration === undefined) {
      throw new Error("The topic did not enable report notifications.");
    }

    // Then every calendar period, every question and five rows are selected.
    assertIdentical(configuration.topic, topic);
    assertUndefined(configuration.questions);
    assertArrayLength(configuration.periods, 4);
    assertIdentical(configuration.maxRowsPerQuestion, 5);
    assertUndefined(configuredReportNotifications(undefined, []));
    assertReportNotificationQuestions(configuration, ["pageviews"]);
  });

  it("serialises a selected question for the publisher", () => {
    // Given an enabled deployment and one selected report question.
    const { summaries } = summariesWithEmail("reports@example.com");
    const notifications = summaries.reportNotifications;
    if (notifications === undefined) {
      throw new Error("The deployment did not create report notifications.");
    }
    const configuration = reportNotificationConfiguration({
      emails: ["reports@example.com"],
      questions: ["pageviews"],
    });

    // When the settings are checked and serialised for the publisher.
    assertReportNotificationQuestions(configuration, ["pageviews"]);
    const environment = reportNotificationLambdaEnvironment(
      summaries.bucket,
      notifications.topic,
      configuration,
    );

    // Then the publisher receives the explicit selection as JSON.
    assertIdentical(
      environment[reportNotificationEnvironment.questions],
      '["pageviews"]',
    );
  });

  it("refuses invalid notification choices at synthesis", () => {
    // Given invalid values for each bounded or unique configuration field.
    const invalid = [
      { emails: [""] },
      { emails: ["reports@example.com", "reports@example.com"] },
      { emails: ["reports@example.com"], periods: [] },
      { emails: ["reports@example.com"], periods: ["day", "day"] },
      { emails: ["reports@example.com"], periods: ["quarter"] },
      { emails: ["reports@example.com"], questions: [""] },
      {
        emails: ["reports@example.com"],
        questions: ["pageviews", "pageviews"],
      },
      { emails: ["reports@example.com"], maxRowsPerQuestion: 0 },
      { emails: ["reports@example.com"], maxRowsPerQuestion: 1.5 },
      { emails: ["reports@example.com"], subjectPrefix: "" },
      { emails: ["reports@example.com"], subjectPrefix: "line\nbreak" },
      { emails: ["reports@example.com"], subjectPrefix: "x".repeat(71) },
    ];

    // When each setting is settled, then no invalid template can be emitted.
    for (const props of invalid) {
      assertThrowsError(() =>
        reportNotificationConfiguration(
          props as Parameters<typeof reportNotificationConfiguration>[0],
        ),
      );
    }
  });
});
