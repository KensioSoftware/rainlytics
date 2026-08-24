import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ArnFormat, Duration, RemovalPolicy, Stack } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import { logDeliveryRegion } from "./delivery-region.js";

/**
 * How long raw logs are kept when nothing says otherwise.
 *
 * A year, which is long enough to recompute a full history and to compare a
 * month against the same month last year. Raw is the immutable record every
 * derived dataset is rebuilt from, so this expiry is also the hard limit on
 * what can ever be recomputed. Shortening it discards history that cannot be
 * recovered.
 *
 * Generous is cheap at the traffic Rainlytics is built for. A busy site
 * should set it deliberately.
 */
export const defaultLogRetention = Duration.days(365);

/**
 * The delivery service writes with `bucket-owner-full-control`, which
 * `BUCKET_OWNER_ENFORCED` permits while refusing every other ACL. Objects
 * therefore belong to the account that owns the bucket rather than to the
 * service that put them there.
 */
const objectOwnership = ObjectOwnership.BUCKET_OWNER_ENFORCED;

/** What a Rainlytics log bucket can be told. */
export interface LogBucketProps {
  /**
   * A name for the bucket. Left out, CloudFormation names it.
   *
   * CloudFront's delivery destination accepts a bucket name matching `[\w-]`
   * only, and S3 forbids uppercase and underscores in a name, so what is
   * left is lowercase letters, digits and hyphens. A name carrying a dot
   * deploys as a bucket and then fails when the delivery is pointed at it,
   * which is why this is checked here instead.
   */
  readonly bucketName?: string | undefined;

  /**
   * How long an object is kept before S3 expires it.
   *
   * @default {@link defaultLogRetention}
   */
  readonly retention?: Duration | undefined;

  /**
   * A KMS key to encrypt objects with, in place of S3-managed encryption.
   *
   * Left out on purpose by default. SSE-KMS charges per request, and a log
   * bucket is written to constantly and read by every query, so the cost
   * arrives twice and scales with use. The key policy also has to grant
   * `delivery.logs.amazonaws.com` the usual five actions, or delivery fails
   * silently from the bucket's point of view.
   *
   * @default S3-managed encryption, which costs nothing
   */
  readonly encryptionKey?: IKey | undefined;

  /**
   * Whether destroying the bucket empties it first.
   *
   * Off by default, and deliberately not implied by `removalPolicy`. A
   * bucket that still holds objects refuses to be deleted, which reads as a
   * confusing CloudFormation failure. Emptying it silently is the worse of
   * the two, because what gets deleted is the raw record every derived
   * dataset is rebuilt from, so this stays something a caller asks for.
   *
   * Only meaningful alongside `RemovalPolicy.DESTROY`. CDK refuses the
   * combination with any other policy.
   *
   * @default false
   */
  readonly autoDeleteObjects?: boolean | undefined;

  /**
   * What happens to the bucket when the stack goes.
   *
   * @default RemovalPolicy.RETAIN, so destroying a stack never destroys the
   *   analytics history along with it
   */
  readonly removalPolicy?: RemovalPolicy | undefined;
}

/**
 * An S3 bucket set up to receive CloudFront standard logging v2 deliveries.
 *
 * Nothing here transitions objects to a colder storage class, which is the
 * usual reflex for logs and the wrong one at this size. S3 Standard-IA bills
 * a minimum of 128KB per object, and CloudFront log objects on a quiet site
 * are frequently smaller than that, so the cheaper per-GB rate is applied to
 * several times the bytes and the transition costs more than it saves.
 * Expiry does the work instead.
 *
 * Versioning is off for the same reason it is off on most log stores. The
 * objects are written once by a service and never updated, so a version
 * history would hold one version each and be billed for it.
 */
export class LogBucket extends Construct {
  /** The bucket itself, for the delivery to be pointed at. */
  readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: LogBucketProps = {}) {
    super(scope, id);

    if (props.bucketName !== undefined) {
      assertDeliverableBucketName(props.bucketName);
    }

    this.bucket = new Bucket(this, "Bucket", {
      ...(props.bucketName === undefined
        ? {}
        : { bucketName: props.bucketName }),
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership,
      encryption:
        props.encryptionKey === undefined
          ? BucketEncryption.S3_MANAGED
          : BucketEncryption.KMS,
      ...(props.encryptionKey === undefined
        ? {}
        : { encryptionKey: props.encryptionKey }),
      enforceSSL: true,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      ...(props.autoDeleteObjects === undefined
        ? {}
        : { autoDeleteObjects: props.autoDeleteObjects }),
      lifecycleRules: [
        {
          id: "expire-raw-logs",
          enabled: true,
          expiration: props.retention ?? defaultLogRetention,
        },
        {
          // Parts of an upload that never completed are invisible in the
          // console and billed like anything else.
          id: "abort-incomplete-uploads",
          enabled: true,
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    });

    this.allowLogDelivery();
  }

  /**
   * Lets the CloudFront delivery service write into the bucket.
   *
   * AWS adds this statement itself when logging is enabled, so it looks
   * redundant. It is not, because `enforceSSL` above makes CloudFormation the
   * owner of the bucket policy, and CloudFormation sets that policy to
   * whatever the template says on every update. A statement AWS added out of
   * band survives until the next stack update touches the policy and then
   * disappears, taking log delivery with it and reporting nothing.
   *
   * Scoped to this account and to delivery sources in the region deliveries
   * are configured from. The `s3:x-amz-acl` condition AWS documents is left
   * out on purpose: this bucket has ACLs disabled, and a `StringEquals` on a
   * condition key the request never carries denies the write.
   */
  private allowLogDelivery(): void {
    const stack = Stack.of(this);

    this.bucket.grantPut(
      new ServicePrincipal("delivery.logs.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": stack.account },
          ArnLike: {
            "aws:SourceArn": stack.formatArn({
              service: "logs",
              region: logDeliveryRegion,
              account: stack.account,
              resource: "delivery-source",
              resourceName: "*",
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          },
        },
      }),
    );
  }
}

/** The names CloudFront's delivery destination will accept. */
const deliverableBucketName = /^[a-z0-9-]+$/u;

function assertDeliverableBucketName(bucketName: string): void {
  if (!deliverableBucketName.test(bucketName)) {
    throw new Error(
      `Bucket name "${bucketName}" cannot receive CloudFront log deliveries.` +
        ` The delivery destination accepts lowercase letters, digits and` +
        ` hyphens only, so a name with a dot in it creates a bucket that` +
        ` delivery then refuses to write to.`,
    );
  }
}
