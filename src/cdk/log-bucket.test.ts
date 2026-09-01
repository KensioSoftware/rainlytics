import {
  assertArrayIncludes,
  assertIdentical,
  assertObjectMatches,
  assertStringIncludes,
  assertStringMatches,
  assertStringNotIncludes,
  assertThrowsError,
  assertTrue,
  assertUndefined,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { App, Duration, RemovalPolicy, Stack } from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { LogBucket, type LogBucketProps } from "./log-bucket.js";

/**
 * The parts of an S3 lifecycle rule these cases read.
 *
 * Declared here rather than imported, so that reading a bucket back does not
 * pull `@aws-sdk/client-s3` into a package whose production code has no use
 * for it.
 */
interface LifecycleRule {
  readonly ID?: string | undefined;
  readonly Status?: string | undefined;
  readonly Expiration?:
    | {
        readonly Days?: number | undefined;
        readonly ExpiredObjectDeleteMarker?: boolean | undefined;
      }
    | undefined;
  readonly AbortIncompleteMultipartUpload?:
    | { readonly DaysAfterInitiation?: number | undefined }
    | undefined;
  readonly NoncurrentVersionExpiration?:
    | { readonly NoncurrentDays?: number | undefined }
    | undefined;
}

describe("the raw log bucket", () => {
  const anAccount = (): string =>
    faker.string.numeric({ length: 12, allowLeadingZeros: false });

  const aBucketName = (): string => `rainlytics-logs-${faker.string.uuid()}`;

  /**
   * One lifecycle rule by id, failing loudly when it is absent.
   *
   * A rule that has gone missing should fail as a missing rule rather than as
   * `undefined` having no `Expiration`, which reads as though the assertion
   * itself is broken.
   */
  const ruleNamed = (
    lifecycle: { Rules?: readonly LifecycleRule[] | undefined },
    id: string,
  ): LifecycleRule => {
    const rule = (lifecycle.Rules ?? []).find(
      (candidate) => candidate.ID === id,
    );
    if (rule === undefined) {
      throw new Error(
        `No lifecycle rule "${id}". Found: ${(lifecycle.Rules ?? [])
          .map((candidate) => candidate.ID)
          .join(", ")}`,
      );
    }
    return rule;
  };

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
   * Simulated S3 applies the bucket's public access, lifecycle and versioning
   * settings. Those cases read the deployed state back. OwnershipControls is
   * still recorded as a property the simulation cannot model.
   *
   * The deployment cases read the simulation back. Ownership reads the
   * synthesised template instead, a weaker claim that says what CloudFormation
   * was asked to apply. The last deployment case records that limitation.
   */

  describe("read back from a deployment", () => {
    it("creates a bucket in the region its stack names", async () => {
      // Given a stack with a Rainlytics log bucket in it.
      const bucketName = aBucketName();

      // When it is deployed.
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      // Then the bucket is there, in that region and no other.
      const buckets = await simAws
        .region("eu-west-2")
        .s3()
        .listBuckets({ input: {} });
      assertArrayIncludes(
        buckets.Buckets?.map((bucket) => bucket.Name),
        bucketName,
      );
    });

    it("blocks every route to making an object public", async () => {
      // Given a deployed log bucket.
      const bucketName = aBucketName();
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
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
      assertObjectMatches(block.PublicAccessBlockConfiguration, {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    });

    it("enables object versioning", async () => {
      // Given a deployed log bucket.
      const bucketName = aBucketName();
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      // When S3 is asked how the bucket handles object versions.
      const versioning = await simAws
        .region("eu-west-2")
        .s3()
        .getBucketVersioning({ input: { Bucket: bucketName } });

      // Then versioning is on. A deleted log can be recovered, and AWS Backup
      // accepts the bucket.
      assertIdentical(versioning.Status, "Enabled");
    });

    it("retains raw logs long enough to recompute a leap year", async () => {
      // Given a deployed log bucket taking the default retention.
      const bucketName = aBucketName();
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      // When S3 is asked what lifecycle rules the bucket carries.
      const lifecycle = await simAws
        .region("eu-west-2")
        .s3()
        .getBucketLifecycleConfiguration({ input: { Bucket: bucketName } });

      // Then objects expire after 370 days. That covers a 366-day annual
      // report and the next scheduled recomputation. Raw is the immutable
      // record everything else is rebuilt from, so this rule is also the
      // limit on what can ever be recomputed.
      //
      // The number is written out. Reading it from `defaultLogRetention`
      // would take the expected value from the thing under test, so changing
      // the default would move both sides and this would still pass.
      const expiry = ruleNamed(lifecycle, "expire-raw-logs");
      assertIdentical(expiry.Status, "Enabled");
      assertIdentical(expiry.Expiration?.Days, 370);
    });

    it("keeps an expired object recoverable during the recovery window", async () => {
      // Given a deployed log bucket with a log object in it.
      const bucketName = aBucketName();
      const key = `distributionid=E1EXAMPLE/year=2026/${faker.string.uuid()}`;
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      const s3 = simAws.region("eu-west-2").s3();
      await s3.putObject({
        input: { Bucket: bucketName, Key: key, Body: "a log line" },
      });

      // When the 370-day retention and another day pass.
      await simAws.clock().advanceBy({ days: 371 });

      // Then the current object is a delete marker, with the old version kept
      // under it. A plain read sees no object, while its contents stay
      // recoverable for another thirty days.
      const remaining = await s3.listObjectVersions({
        input: { Bucket: bucketName, Prefix: key },
      });
      assertArrayIncludes(
        remaining.Versions?.map((version) => version.Key),
        key,
      );
      assertTrue(
        remaining.DeleteMarkers?.some(
          (marker) => marker.Key === key && marker.IsLatest,
        ),
      );
    });

    it("keeps an object that is still inside its retention", async () => {
      // Given the same bucket and object.
      const bucketName = aBucketName();
      const key = `distributionid=E1EXAMPLE/year=2026/${faker.string.uuid()}`;
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      const s3 = simAws.region("eu-west-2").s3();
      await s3.putObject({
        input: { Bucket: bucketName, Key: key, Body: "a log line" },
      });

      // When most of the retention passes, but not all of it.
      await simAws.clock().advanceBy({ days: 369 });

      // Then it is still there. Without this, a rule that expired everything
      // immediately would pass the case above.
      const remaining = await s3.listObjectsV2({
        input: { Bucket: bucketName },
      });
      assertArrayIncludes(
        remaining.Contents?.map((object) => object.Key),
        key,
      );
    });

    it("keeps raw logs for as long as it is told to", async () => {
      // Given a site that wants two years rather than the default one.
      const bucketName = aBucketName();
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", {
          bucketName,
          retention: Duration.days(730),
        });
      });

      // When S3 is asked what it will do.
      const lifecycle = await simAws
        .region("eu-west-2")
        .s3()
        .getBucketLifecycleConfiguration({ input: { Bucket: bucketName } });

      // Then that is the rule it holds.
      assertIdentical(
        ruleNamed(lifecycle, "expire-raw-logs").Expiration?.Days,
        730,
      );
    });

    it("clears superseded versions after the recovery window", async () => {
      // Given two versions of one object in a deployed log bucket.
      const bucketName = aBucketName();
      const key = `distributionid=E1EXAMPLE/year=2026/${faker.string.uuid()}`;
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      const s3 = simAws.region("eu-west-2").s3();
      await s3.putObject({
        input: { Bucket: bucketName, Key: key, Body: "first version" },
      });
      await s3.putObject({
        input: { Bucket: bucketName, Key: key, Body: "second version" },
      });

      // When the thirty-day recovery window and another day pass.
      await simAws.clock().advanceBy({ days: 31 });

      // Then the current version remains and the superseded one is gone. This
      // rule bounds what versioning stores after an overwrite or deletion.
      const remaining = await s3.listObjectVersions({
        input: { Bucket: bucketName, Prefix: key },
      });
      assertIdentical(remaining.Versions?.length, 1);
    });

    it("holds superseded versions for as long as it is told to", async () => {
      // Given a site that wants a longer window to notice a deletion in.
      const bucketName = aBucketName();
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", {
          bucketName,
          recoveryWindow: Duration.days(90),
        });
      });

      // When S3 is asked what it will do.
      const lifecycle = await simAws
        .region("eu-west-2")
        .s3()
        .getBucketLifecycleConfiguration({ input: { Bucket: bucketName } });

      // Then that is the rule it holds.
      assertIdentical(
        ruleNamed(lifecycle, "expire-superseded-logs")
          .NoncurrentVersionExpiration?.NoncurrentDays,
        90,
      );
    });

    it("keeps the delete marker rule out of the expiry rule", async () => {
      // Given a deployed log bucket.
      const bucketName = aBucketName();
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      // When S3 is asked what lifecycle rules the bucket carries.
      const lifecycle = await simAws
        .region("eu-west-2")
        .s3()
        .getBucketLifecycleConfiguration({ input: { Bucket: bucketName } });

      // Then `expire-raw-logs` carries the expiry in days and says nothing
      // about delete markers. S3 refuses a rule holding both, and CDK refuses
      // it at synthesis, so folding the two together fails rather than
      // misbehaves. This is here because the tidier-looking version of this
      // construct is the one that does not deploy.
      const expiry = ruleNamed(lifecycle, "expire-raw-logs");
      assertObjectMatches(expiry, { Expiration: { Days: 370 } });
      assertUndefined(expiry.Expiration.ExpiredObjectDeleteMarker);
    });

    it("aborts uploads that never finished", async () => {
      // Given a deployed log bucket.
      const bucketName = aBucketName();
      const { simAws } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName });
      });

      // When S3 is asked what lifecycle rules it carries.
      const lifecycle = await simAws
        .region("eu-west-2")
        .s3()
        .getBucketLifecycleConfiguration({ input: { Bucket: bucketName } });

      // Then abandoned multipart parts are aborted rather than billed
      // indefinitely. They do not appear in the console, so nothing else
      // would ever notice them.
      const abort = ruleNamed(lifecycle, "abort-incomplete-uploads");
      assertIdentical(
        abort.AbortIncompleteMultipartUpload?.DaysAfterInitiation,
        7,
      );
    });

    it("records the property the simulation cannot model", async () => {
      // Given a deployed log bucket.
      const { stacks } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName: aBucketName() });
      });

      // Then ownership is reported as unmodelled. Lifecycle and versioning
      // used to appear here, and the deployment cases above now exercise
      // both.
      const ignored = stacks.get("LogStack")?.ignoredProperties ?? [];
      const unmodelled = ignored.map((property) => property.path).join(" ");
      assertStringIncludes(unmodelled, "OwnershipControls");
      assertStringNotIncludes(unmodelled, "VersioningConfiguration");
      assertStringNotIncludes(unmodelled, "LifecycleConfiguration");
    });
  });

  describe("read off the synthesised template", () => {
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

    it("lets the CloudFront delivery service write into it", () => {
      // Given a log bucket.
      // When the stack is synthesised.
      const { template } = synthesiseLogBucket();

      // Then the bucket policy allows the delivery service to put objects.
      // AWS adds this itself when logging is enabled, but `enforceSSL` makes
      // CloudFormation the owner of this policy, and CloudFormation writes
      // whatever the template says on every update. A statement added out of
      // band lasts until the next one and then takes delivery with it.
      const policy = JSON.stringify(
        template.findResources("AWS::S3::BucketPolicy"),
      );
      assertStringIncludes(policy, "delivery.logs.amazonaws.com");
      assertStringIncludes(policy, "s3:PutObject");
    });

    it("scopes that write to this account and its delivery sources", () => {
      // Given a log bucket in a known account.
      const stack = new Stack(new App(), "LogStack", {
        env: { account: "123456789012", region: "eu-west-2" },
      });
      new LogBucket(stack, "RainlyticsLogs", { bucketName: aBucketName() });

      // When the stack is synthesised.
      const policy = JSON.stringify(
        Template.fromStack(stack).findResources("AWS::S3::BucketPolicy"),
      );

      // Then both conditions are on it, and the delivery-source ARN names
      // us-east-1 whatever region the bucket is in, because that is the only
      // region a delivery can be configured from.
      assertStringIncludes(policy, '"aws:SourceAccount":"123456789012"');
      assertStringIncludes(
        policy,
        ":logs:us-east-1:123456789012:delivery-source:*",
      );
    });

    it("asks for no ACL, because the bucket has them disabled", () => {
      // Given a log bucket, whose object ownership is BucketOwnerEnforced.
      const { template } = synthesiseLogBucket();

      // Then the delivery grant carries no `s3:x-amz-acl` condition. AWS
      // documents one, and a StringEquals on a key the request never sends
      // denies the write rather than permitting it.
      const policy = JSON.stringify(
        template.findResources("AWS::S3::BucketPolicy"),
      );
      assertStringNotIncludes(policy, "x-amz-acl");
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
    {
      const error = assertThrowsError(synthesising);
      assertStringMatches(error.message, /delivery/u);
    }
  });
});
