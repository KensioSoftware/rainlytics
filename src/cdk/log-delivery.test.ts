import { faker } from "@faker-js/faker";
import { Key } from "aws-cdk-lib/aws-kms";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { App, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { deliveredLogFieldNames } from "../log-fields.js";
import { deliverySuffixPath } from "../partitions.js";
import {
  CloudFrontLogDelivery,
  type CloudFrontLogDeliveryProps,
} from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";

/** The parts of a described delivery these cases read. */
interface DescribedDelivery {
  readonly deliverySourceName?: string | undefined;
  readonly deliveryDestinationType?: string | undefined;
  readonly recordFields?: readonly string[] | undefined;
  readonly s3DeliveryConfiguration?:
    | {
        readonly suffixPath?: string | undefined;
        readonly enableHiveCompatiblePath?: boolean | undefined;
      }
    | undefined;
}

interface LogsAccessor {
  describeDeliveries: (a: {
    input: Record<string, never>;
  }) => Promise<{ deliveries?: readonly DescribedDelivery[] | undefined }>;
  describeDeliverySources: (a: { input: Record<string, never> }) => Promise<{
    deliverySources?:
      | readonly { name?: string; resourceArns?: readonly string[] }[]
      | undefined;
  }>;
  describeDeliveryDestinations: (a: {
    input: Record<string, never>;
  }) => Promise<{
    deliveryDestinations?:
      | readonly {
          name?: string;
          outputFormat?: string;
          deliveryDestinationConfiguration?: {
            destinationResourceArn?: string;
          };
        }[]
      | undefined;
  }>;
}

describe("delivering CloudFront access logs", () => {
  const anAccount = (): string =>
    faker.string.numeric({ length: 12, allowLeadingZeros: false });

  const aDistributionId = (): string =>
    `E${faker.string.alphanumeric({ length: 13, casing: "upper" })}`;

  /**
   * The delivery deployed into a simulated account, with the log bucket
   * beside it. Both go in one us-east-1 stack, which is where the delivery
   * has to be, and a real consumer's distribution lives somewhere else.
   */
  const deployDelivery = async (
    props: Partial<CloudFrontLogDeliveryProps> = {},
  ) => {
    const distributionId = props.distributionId ?? aDistributionId();
    const account = anAccount();
    const { simAws } = await deployStacks((app: App) => {
      const stack = new Stack(app, "DeliveryStack", {
        env: { account, region: "us-east-1" },
      });
      const logs = new LogBucket(stack, "RainlyticsLogs", {
        bucketName: `rainlytics-logs-${faker.string.uuid()}`,
      });
      new CloudFrontLogDelivery(stack, "Delivery", {
        ...props,
        distributionId,
        logBucket: props.logBucket ?? logs.bucket,
      });
    });
    const logsApi = simAws
      .region("us-east-1")
      .account()
      .logs() as unknown as LogsAccessor;
    return { simAws, logsApi, distributionId, account };
  };

  it("points a delivery at the distribution it was given", async () => {
    // Given a distribution whose logs should be collected.
    // When the delivery is deployed.
    const { logsApi, distributionId, account } = await deployDelivery();

    // Then a delivery source names that distribution, by the ARN CloudFront
    // is identified with rather than by the bare id.
    const sources = await logsApi.describeDeliverySources({ input: {} });
    expect(sources.deliverySources?.[0]?.resourceArns).toContain(
      `arn:aws:cloudfront::${account}:distribution/${distributionId}`,
    );
  });

  it("writes into the log bucket under a prefix of its own", async () => {
    // Given a delivery with the default prefix.
    // When it is deployed.
    const { logsApi } = await deployDelivery();

    // Then the destination names the bucket and the prefix together, which
    // is how CloudFront is told where inside the bucket to write. Without a
    // prefix, CloudFront invents `AWSLogs/{account-id}/CloudFront`.
    const destinations = await logsApi.describeDeliveryDestinations({
      input: {},
    });
    const arn =
      destinations.deliveryDestinations?.[0]?.deliveryDestinationConfiguration
        ?.destinationResourceArn;
    expect(arn).toMatch(/^arn:aws:s3:::rainlytics-logs-[\w-]+\/rainlytics$/u);
  });

  it("writes the partition layout the reader will address", async () => {
    // Given a delivery taking the default granularity.
    // When it is deployed.
    const { logsApi } = await deployDelivery();

    // Then it writes Hive-compatible paths under exactly the suffix the
    // partition layout renders. These two agreeing is what lets Athena read
    // back what CloudFront wrote.
    const described = await logsApi.describeDeliveries({ input: {} });
    const delivery = described.deliveries?.[0];
    expect(delivery?.s3DeliveryConfiguration?.enableHiveCompatiblePath).toBe(
      true,
    );
    expect(delivery?.s3DeliveryConfiguration?.suffixPath).toBe(
      deliverySuffixPath("hourly"),
    );
  });

  it("partitions daily when asked to", async () => {
    // Given a site that wants day-sized partitions.
    // When the delivery is deployed with that granularity.
    const { logsApi } = await deployDelivery({ granularity: "daily" });

    // Then the suffix path carries no hour.
    const described = await logsApi.describeDeliveries({ input: {} });
    const delivery = described.deliveries?.[0];
    expect(delivery?.s3DeliveryConfiguration?.suffixPath).toBe(
      deliverySuffixPath("daily"),
    );
    expect(delivery?.s3DeliveryConfiguration?.suffixPath).not.toContain(
      "hour=",
    );
  });

  it("asks for the Rainlytics field set", async () => {
    // Given a delivery taking the default fields.
    // When it is deployed.
    const { logsApi } = await deployDelivery();

    // Then CloudFront is asked for exactly what the rollups read, and the
    // beacon's query string among them. A field missing here is a column
    // that never exists, since the raw store keeps what was delivered.
    const described = await logsApi.describeDeliveries({ input: {} });
    const delivery = described.deliveries?.[0];
    expect(delivery?.recordFields).toStrictEqual([...deliveredLogFieldNames]);
    expect(delivery?.recordFields).toContain("cs-uri-query");
  });

  it("delivers only the fields it is given", async () => {
    // Given a site that wants a narrower set than the default.
    const fields = ["timestamp(ms)", "cs-uri-stem"];

    // When the delivery is deployed with it.
    const { logsApi } = await deployDelivery({ fields });

    // Then that is what CloudFront is asked for.
    const described = await logsApi.describeDeliveries({ input: {} });
    const delivery = described.deliveries?.[0];
    expect(delivery?.recordFields).toStrictEqual(fields);
  });

  it("writes JSON unless another format is chosen", async () => {
    // Given a delivery taking the default output format.
    // When it is deployed.
    const { logsApi } = await deployDelivery();

    // Then it is JSON. Parquet is the better shape for a dataset Athena
    // reads and carries an undocumented conversion charge, so it waits on
    // the numbers from #9.
    const destinations = await logsApi.describeDeliveryDestinations({
      input: {},
    });
    expect(destinations.deliveryDestinations?.[0]?.outputFormat).toBe("json");
  });

  it("writes Parquet when asked to", async () => {
    // Given a site that has decided Parquet is worth its conversion charge.
    // When the delivery is deployed with it.
    const { logsApi } = await deployDelivery({ outputFormat: "parquet" });

    // Then that is the format on the destination.
    const destinations = await logsApi.describeDeliveryDestinations({
      input: {},
    });
    expect(destinations.deliveryDestinations?.[0]?.outputFormat).toBe(
      "parquet",
    );
  });

  describe("when the log bucket is encrypted with a KMS key", () => {
    it("lets the delivery service use a key it can reach", () => {
      // Given a log bucket encrypted with a key declared in the same stack.
      const stack = new Stack(new App(), "DeliveryStack", {
        env: { account: anAccount(), region: "us-east-1" },
      });
      const encryptionKey = new Key(stack, "LogKey");
      const logs = new LogBucket(stack, "RainlyticsLogs", { encryptionKey });
      new CloudFrontLogDelivery(stack, "Delivery", {
        distributionId: aDistributionId(),
        logBucket: logs.bucket,
      });

      // When the stack is synthesised.
      const template = Template.fromStack(stack);

      // Then the key policy lets the delivery service use it. Without this
      // the bucket refuses the write and nothing reports it: the deploy
      // succeeds and the logs simply never arrive.
      const grant = Match.objectLike({
        Principal: { Service: "delivery.logs.amazonaws.com" },
        Action: Match.arrayWith(["kms:Decrypt", "kms:DescribeKey"]),
      });
      template.hasResourceProperties("AWS::KMS::Key", {
        KeyPolicy: Match.objectLike({ Statement: Match.arrayWith([grant]) }),
      });
    });

    it("scopes that grant to this account and its delivery sources", () => {
      // Given the same stack.
      const stack = new Stack(new App(), "DeliveryStack", {
        env: { account: "123456789012", region: "us-east-1" },
      });
      const encryptionKey = new Key(stack, "LogKey");
      const logs = new LogBucket(stack, "RainlyticsLogs", { encryptionKey });
      new CloudFrontLogDelivery(stack, "Delivery", {
        distributionId: aDistributionId(),
        logBucket: logs.bucket,
      });

      // When the stack is synthesised.
      const template = Template.fromStack(stack);

      // Then both conditions are on the grant. An unconditioned one lets the
      // delivery service use this key on behalf of any account that asks,
      // which is the confused deputy the pair exists to close.
      // The ARN is assembled from the partition at deploy time, so this
      // reads the serialised statement rather than matching a literal.
      const keyPolicy = JSON.stringify(template.findResources("AWS::KMS::Key"));
      expect(keyPolicy).toContain('"aws:SourceAccount":"123456789012"');
      expect(keyPolicy).toContain(
        ":logs:us-east-1:123456789012:delivery-source:*",
      );
    });

    it("warns rather than pretending, when the key is imported", () => {
      // Given a bucket encrypted with a key from another template, which CDK
      // cannot add a policy statement to.
      const stack = new Stack(new App(), "DeliveryStack", {
        env: { account: "123456789012", region: "us-east-1" },
      });
      const encryptionKey = Key.fromKeyArn(
        stack,
        "ImportedKey",
        "arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
      );
      const logs = new LogBucket(stack, "RainlyticsLogs", { encryptionKey });

      // When the delivery is added.
      new CloudFrontLogDelivery(stack, "Delivery", {
        distributionId: aDistributionId(),
        logBucket: logs.bucket,
      });

      // Then it says so. `key.grant` on an imported key writes to a policy
      // nobody applies, so the grant silently does nothing and the failure
      // arrives later as logs that never appear.
      Annotations.fromStack(stack).hasWarning(
        "/DeliveryStack/Delivery",
        Match.stringLikeRegexp("imported KMS key"),
      );
    });
  });

  it("refuses to be deployed outside us-east-1", async () => {
    // Given the delivery placed beside the rest of a consumer's site, which
    // is the easy mistake since that is where everything else lives.
    const deploying = deployStacks((app: App) => {
      const stack = new Stack(app, "SiteStack", {
        env: { account: anAccount(), region: "eu-west-2" },
      });
      const logs = new LogBucket(stack, "RainlyticsLogs", {
        bucketName: `rainlytics-logs-${faker.string.uuid()}`,
      });
      new CloudFrontLogDelivery(stack, "Delivery", {
        distributionId: aDistributionId(),
        logBucket: logs.bucket,
      });
    });

    // Then it fails at synthesis, naming the stack. The CloudWatch Logs API
    // takes these calls in us-east-1 and nowhere else.
    await expect(deploying).rejects.toThrow(/SiteStack/u);
    await expect(deploying).rejects.toThrow(/us-east-1/u);
  });
});
