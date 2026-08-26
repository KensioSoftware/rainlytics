import { faker } from "@faker-js/faker";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { App, Duration, RemovalPolicy, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

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
      expect(buckets.Buckets?.map((bucket) => bucket.Name)).toContain(
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
      expect(block.PublicAccessBlockConfiguration).toMatchObject({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    });

    it("expires raw logs after a year unless told otherwise", async () => {
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

      // Then objects expire after a year. Raw is the immutable record
      // everything else is rebuilt from, so this rule is also the limit on
      // what can ever be recomputed.
      //
      // The number is written out. Reading it from `defaultLogRetention`
      // would take the expected value from the thing under test, so changing
      // the default would move both sides and this would still pass.
      const expiry = ruleNamed(lifecycle, "expire-raw-logs");
      expect(expiry.Status).toBe("Enabled");
      expect(expiry.Expiration?.Days).toBe(365);
    });

    it("actually deletes an object once its year is up", async () => {
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

      // When a year and a day pass.
      await simAws.clock().advanceBy({ days: 366 });

      // Then the object is gone. This is the case the retention rule exists
      // for, and until yulin 1.20.6 nothing here could tell the difference
      // between a rule that works and a rule that was merely written down.
      const remaining = await s3.listObjectsV2({
        input: { Bucket: bucketName },
      });
      expect(remaining.Contents ?? []).toHaveLength(0);
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

      // When most of a year passes, but not all of it.
      await simAws.clock().advanceBy({ days: 364 });

      // Then it is still there. Without this, a rule that expired everything
      // immediately would pass the case above.
      const remaining = await s3.listObjectsV2({
        input: { Bucket: bucketName },
      });
      expect(remaining.Contents?.map((object) => object.Key)).toContain(key);
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
      expect(ruleNamed(lifecycle, "expire-raw-logs").Expiration?.Days).toBe(
        730,
      );
    });

    it("clears superseded versions after the recovery window", async () => {
      // Given a deployed log bucket taking the default recovery window.
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

      // Then a superseded version goes for good after thirty days, and the
      // delete marker over it goes once it is the only thing left. This is
      // the rule that makes versioning affordable. Without it the expiry
      // above stops deleting anything the day versioning goes on, and the
      // bucket grows by a year of logs a year and never shrinks.
      //
      // Thirty is written out. Reading it from `defaultRecoveryWindow` would
      // take the expected value from the thing under test.
      const superseded = ruleNamed(lifecycle, "expire-superseded-logs");
      expect(superseded.Status).toBe("Enabled");
      expect(superseded.NoncurrentVersionExpiration?.NoncurrentDays).toBe(30);
      expect(superseded.Expiration?.ExpiredObjectDeleteMarker).toBe(true);
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
      expect(
        ruleNamed(lifecycle, "expire-superseded-logs")
          .NoncurrentVersionExpiration?.NoncurrentDays,
      ).toBe(90);
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
      expect(expiry.Expiration?.Days).toBe(365);
      expect(expiry.Expiration?.ExpiredObjectDeleteMarker).toBeUndefined();
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
      expect(abort.AbortIncompleteMultipartUpload?.DaysAfterInitiation).toBe(7);
    });

    it("records the properties the simulation could not model", async () => {
      // Given a deployed log bucket.
      const { stacks } = await deployStacks((app: App, account: string) => {
        const stack = new Stack(app, "LogStack", {
          env: { account, region: "eu-west-2" },
        });
        new LogBucket(stack, "RainlyticsLogs", { bucketName: aBucketName() });
      });

      // Then ownership and versioning are reported as unmodelled rather than
      // quietly applied, which is what keeps the template assertions below
      // honest. Lifecycle used to be on this list and was simulated in yulin
      // 1.20.6, so those cases read the deployment now.
      //
      // Versioning matters more here than ownership does, and the expiry
      // cases above are why. Simulated S3 deletes an expired object outright.
      // Real S3 on a versioned bucket writes a delete marker and keeps the
      // version under it until `expire-superseded-logs` takes it a month
      // later. So "actually deletes an object once its year is up" makes a
      // weaker claim than it reads as, and this case is what says so.
      const ignored = stacks.get("LogStack")?.ignoredProperties ?? [];
      const unmodelled = ignored.map((property) => property.path).join(" ");
      expect(unmodelled).toContain("OwnershipControls");
      expect(unmodelled).toContain("VersioningConfiguration");
      expect(unmodelled).not.toContain("LifecycleConfiguration");
    });
  });

  describe("read off the synthesised template", () => {
    it("keeps every version of every object", () => {
      // Given a log bucket.
      // When the stack is synthesised.
      const { template } = synthesiseLogBucket();

      // Then versioning is on. A log object is written once by a service and
      // never updated, so this adds no second version to anything. What it
      // adds is that a deleted object can be got back, and that AWS Backup
      // will take the bucket, which it refuses to do without this.
      template.hasResourceProperties("AWS::S3::Bucket", {
        VersioningConfiguration: { Status: "Enabled" },
      });
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
      expect(policy).toContain("delivery.logs.amazonaws.com");
      expect(policy).toContain("s3:PutObject");
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
      expect(policy).toContain('"aws:SourceAccount":"123456789012"');
      expect(policy).toContain(
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
      expect(policy).not.toContain("x-amz-acl");
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
