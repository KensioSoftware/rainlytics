import { faker } from "@faker-js/faker";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { App, Duration, RemovalPolicy, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { LogBucket, type LogBucketProps } from "./log-bucket.js";

describe("the raw log bucket", () => {
  const anAccount = (): string =>
    faker.string.numeric({ length: 12, allowLeadingZeros: false });

  const aBucketName = (): string => `rainlytics-logs-${faker.string.uuid()}`;

  /** A lifecycle rule matcher, named so the assertions stay one call deep. */
  const lifecycleRule = (
    rule: Record<string, unknown>,
  ): Record<string, unknown> => ({
    LifecycleConfiguration: {
      Rules: Match.arrayWith([Match.objectLike(rule)]),
    },
  });

  /** One stack holding one log bucket, synthesised but not deployed. */
  const synthesiseLogBucket = (
    props: LogBucketProps = {},
  ): { template: Template; bucketName: string } => {
    const bucketName = props.bucketName ?? aBucketName();
    const stack = new Stack(new App(), "LogStack", {
      env: { account: anAccount(), region: "eu-west-2" },
    });
    new LogBucket(stack, "RainlyticsLogs", { ...props, bucketName });
    return { template: Template.fromStack(stack), bucketName };
  };

  /*
   * Two kinds of case below, and the split is not arbitrary.
   *
   * Simulated S3 acts on four AWS::S3::Bucket properties: BucketName,
   * NotificationConfiguration, PublicAccessBlockConfiguration and
   * WebsiteConfiguration. It records LifecycleConfiguration and
   * OwnershipControls as properties it cannot model, along with the reason,
   * and creates the Bucket without them.
   *
   * So the cases that can read the simulation back do, and the ones about
   * lifecycle and ownership read the synthesised template instead, which is a
   * weaker claim. It says CloudFormation was asked for the right thing rather
   * than that the right thing happened. That is the strongest evidence
   * available for those properties today, and the last case here proves the
   * limitation is real rather than assumed.
   */

  describe("read back from a deployment", () => {
    it("creates a bucket in the region its stack names", async () => {
      // Given a stack with a Rainlytics log bucket in it.
      const bucketName = aBucketName();

      // When it is deployed.
      const { simAws } = await deployStacks((app: App) => {
        const stack = new Stack(app, "LogStack", {
          env: { account: anAccount(), region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      // Then the bucket is there, in that region and no other.
      const buckets = await simAws
        .region("eu-west-2")
        .s3()
        .listBuckets({ input: {} });
      expect(buckets.Buckets?.map((bucket) => bucket.Name)).toContain(
        bucketName,
      );
    });

    it("blocks every route to making an object public", async () => {
      // Given a deployed log bucket.
      const bucketName = aBucketName();
      const { simAws } = await deployStacks((app: App) => {
        const stack = new Stack(app, "LogStack", {
          env: { account: anAccount(), region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      // When S3 is asked what public access it allows.
      const block = await simAws
        .region("eu-west-2")
        .s3()
        .getPublicAccessBlock({ input: { Bucket: bucketName } });

      // Then all four switches are on. Access logs carry the paths people
      // visited, so a bucket that could be made public is the one failure
      // here that would matter to somebody other than us.
      expect(block.PublicAccessBlockConfiguration).toMatchObject({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    });

    it("records the properties the simulation could not model", async () => {
      // Given a deployed log bucket.
      const { stacks } = await deployStacks((app: App) => {
        const stack = new Stack(app, "LogStack", {
          env: { account: anAccount(), region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName: aBucketName() });
      });

      // Then lifecycle and ownership are reported as unmodelled rather than
      // quietly applied. This case exists to keep the template assertions
      // below honest: the day yulin simulates either one, this fails and the
      // case for those assertions goes with it.
      const ignored = stacks.get("LogStack")?.ignoredProperties ?? [];
      const unmodelled = ignored.map((property) => property.path).join(" ");
      expect(unmodelled).toContain("LifecycleConfiguration");
      expect(unmodelled).toContain("OwnershipControls");
    });
  });

  describe("read off the synthesised template", () => {
    it("expires raw logs after a year unless told otherwise", () => {
      // Given a log bucket taking the default retention.
      // When the stack is synthesised.
      const { template } = synthesiseLogBucket();

      // Then CloudFormation is asked to expire objects after a year. Raw is
      // the immutable record everything else is rebuilt from, so this rule is
      // also the limit on what can ever be recomputed.
      template.hasResourceProperties(
        "AWS::S3::Bucket",
        lifecycleRule({
          Id: "expire-raw-logs",
          Status: "Enabled",
          // A year, written out. Reading it from `defaultLogRetention` would
          // take the expected value from the thing under test, so changing
          // the default would move both sides and the case would still pass.
          ExpirationInDays: 365,
        }),
      );
    });

    it("keeps raw logs for as long as it is told to", () => {
      // Given a site that wants two years rather than the default one.
      // When the stack is synthesised with that retention.
      const { template } = synthesiseLogBucket({
        retention: Duration.days(730),
      });

      // Then that is the rule in the template.
      template.hasResourceProperties(
        "AWS::S3::Bucket",
        lifecycleRule({
          Id: "expire-raw-logs",
          ExpirationInDays: 730,
        }),
      );
    });

    it("aborts uploads that never finished", () => {
      // Given a log bucket.
      // When the stack is synthesised.
      const { template } = synthesiseLogBucket();

      // Then abandoned multipart parts are aborted rather than billed
      // indefinitely. They do not appear in the console, so nothing else
      // would ever notice them.
      template.hasResourceProperties(
        "AWS::S3::Bucket",
        lifecycleRule({
          Id: "abort-incomplete-uploads",
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        }),
      );
    });

    it("takes ownership of what the delivery service writes", () => {
      // Given a log bucket.
      // When the stack is synthesised.
      const { template } = synthesiseLogBucket();

      // Then ACLs are off and objects belong to the bucket owner. The
      // delivery service writes with bucket-owner-full-control, which this
      // setting permits while refusing every other ACL.
      template.hasResourceProperties("AWS::S3::Bucket", {
        OwnershipControls: {
          Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
        },
      });
    });

    it("encrypts with S3-managed keys, which cost nothing per request", () => {
      // Given a log bucket taking the default encryption.
      // When the stack is synthesised.
      const { template } = synthesiseLogBucket();

      // Then it is SSE-S3. A log bucket is written to constantly and read by
      // every query, so SSE-KMS would charge per request at both ends.
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
            },
          ],
        },
      });
    });

    it("lets CloudFormation name the bucket when nothing else does", () => {
      // Given no bucket name, which is what a consumer with no opinion gets.
      const stack = new Stack(new App(), "LogStack", {
        env: { account: anAccount(), region: "eu-west-2" },
      });
      new LogBucket(stack, "RainlyticsLogs");

      // When the stack is synthesised.
      const template = Template.fromStack(stack);

      // Then the bucket carries no name of ours, and CloudFormation picks
      // one. Naming it is the caller's choice rather than a requirement.
      const named = Match.objectLike({ BucketName: Match.anyValue() });
      template.hasResourceProperties("AWS::S3::Bucket", Match.not(named));
    });

    it("encrypts with a KMS key when given one", () => {
      // Given a site that wants its own key, having read what it costs.
      const stack = new Stack(new App(), "LogStack", {
        env: { account: anAccount(), region: "eu-west-2" },
      });
      const encryptionKey = new Key(stack, "LogKey");
      new LogBucket(stack, "RainlyticsLogs", {
        bucketName: aBucketName(),
        encryptionKey,
      });

      // When the stack is synthesised.
      const template = Template.fromStack(stack);

      // Then the bucket is SSE-KMS against that key rather than SSE-S3.
      const byDefault = Match.objectLike({ SSEAlgorithm: "aws:kms" });
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            Match.objectLike({ ServerSideEncryptionByDefault: byDefault }),
          ],
        },
      });
    });

    it("empties itself on the way out only when asked", () => {
      // Given a bucket set to be destroyed and emptied first.
      const { template } = synthesiseLogBucket({
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

      // Then CDK adds the custom resource that empties it. A bucket holding
      // objects refuses to be deleted, so DESTROY without this turns a
      // teardown into a CloudFormation failure.
      template.resourceCountIs("Custom::S3AutoDeleteObjects", 1);
    });

    it("leaves a destroyed bucket to be emptied by hand by default", () => {
      // Given a bucket set to be destroyed and nothing said about emptying.
      const { template } = synthesiseLogBucket({
        removalPolicy: RemovalPolicy.DESTROY,
      });

      // Then nothing is added to empty it. Deleting the raw record every
      // derived dataset is rebuilt from should be asked for out loud.
      template.resourceCountIs("Custom::S3AutoDeleteObjects", 0);
    });

    it("goes with the stack when told to", () => {
      // Given a removal policy chosen deliberately, which is the only way a
      // log bucket should ever become destroyable.
      const { template } = synthesiseLogBucket({
        removalPolicy: RemovalPolicy.DESTROY,
      });

      // Then CloudFormation deletes it with the stack.
      template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
    });

    it("survives the stack that made it", () => {
      // Given the default removal policy.
      // When the stack is synthesised.
      const { template } = synthesiseLogBucket();

      // Then destroying the stack leaves the analytics history behind.
      template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain" });
    });

    it("refuses a request that did not arrive over TLS", () => {
      // Given a log bucket.
      // When the stack is synthesised.
      const { template } = synthesiseLogBucket();

      // Then the bucket policy denies anything arriving in the clear. Access
      // logs carry the paths people visited, so they should not cross a
      // network unencrypted even inside AWS.
      const insecure = Match.objectLike({
        Effect: "Deny",
        Condition: { Bool: { "aws:SecureTransport": "false" } },
      });
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([insecure]),
        }),
      });
    });
  });

  it("refuses a bucket name the delivery destination would reject", () => {
    // Given a name with dots in it, which S3 accepts and the CloudFront
    // delivery destination does not.
    const bucketName = "rainlytics.logs.example.com";

    // When a log bucket is asked for under that name.
    const synthesising = (): unknown => synthesiseLogBucket({ bucketName });

    // Then it fails here, rather than deploying a bucket that the delivery
    // in #8 then refuses to write into.
    expect(synthesising).toThrow(/delivery/u);
  });
});
