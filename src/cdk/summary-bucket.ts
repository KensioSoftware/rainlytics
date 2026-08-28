// Where the precomputed answers live.

import type { Grant, IGrantable } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { Duration, RemovalPolicy } from "aws-cdk-lib/core";
import type { Construct } from "constructs";

/**
 * What the job needs of the bucket it writes into, and what a reader needs of
 * the bucket it reads.
 *
 * Deliberately narrower than `IBucket`, for the reason `LogDeliveryBucket`
 * sets out. Under `exactOptionalPropertyTypes`, CDK's own `Bucket` is not
 * assignable to `IBucket`, so a consumer with that compiler option on cannot
 * pass the bucket they just made.
 *
 * `IBucket` and `Bucket` both satisfy it.
 */
export interface SummariesBucket {
  /** The bucket's name, which the job is given in its environment. */
  readonly bucketName: string;

  /**
   * The bucket's ARN, which `grantReadingSummaries` scopes the read to.
   */
  readonly bucketArn: string;

  /** The key encrypting it, where it is encrypted with one. */
  readonly encryptionKey?: IKey | undefined;

  /** Letting the job put an object in it. */
  readonly grantPut: (
    grantee: IGrantable,
    ...objectsKeyPattern: string[]
  ) => Grant;
}

/** What the bucket holding summaries can be told. */
export interface SummaryBucketProps {
  /**
   * A bucket of your own to write into. One is created where this is left
   * out.
   *
   * Worth passing where summaries are read by something outside the stack
   * that computes them, such as a static site given read access to one
   * prefix.
   */
  readonly summariesBucket?: SummariesBucket | undefined;

  /** A name for the created bucket. Left out, CloudFormation names it. */
  readonly summariesBucketName?: string | undefined;

  /**
   * Whether destroying the created bucket empties it first.
   *
   * Only meaningful alongside `RemovalPolicy.DESTROY`, and CDK refuses the
   * combination with any other policy.
   *
   * @default false
   */
  readonly autoDeleteObjects?: boolean | undefined;

  /**
   * What happens to the created bucket when the stack goes.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy | undefined;
}

/**
 * The bucket a deployment writes summaries into.
 *
 * Its own bucket and never the log bucket. The logs expire on a retention
 * measured in months and the summaries computed from them are the answer
 * that outlives the records, so one lifecycle over both would delete the
 * cheap thing to save the expensive one.
 *
 * No expiry of its own. A year of five questions on both cadences is about
 * 45,000 objects of a few kilobytes each, which is cents of storage, and a
 * summary is the only remaining record of a window once the raw objects have
 * gone. A site that wants one adds a lifecycle rule to a bucket it passes in.
 *
 * Unversioned. A run writes the same key every time it recomputes a window,
 * and versioning would keep every superseded answer for the one file nothing
 * reads twice.
 */
export function summariesBucket(
  scope: Construct,
  props: SummaryBucketProps,
): SummariesBucket {
  if (props.summariesBucket !== undefined) {
    return props.summariesBucket;
  }

  return new Bucket(scope, "Summaries", {
    ...(props.summariesBucketName === undefined
      ? {}
      : { bucketName: props.summariesBucketName }),
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
    encryption: BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
    ...(props.autoDeleteObjects === undefined
      ? {}
      : { autoDeleteObjects: props.autoDeleteObjects }),
    lifecycleRules: [
      {
        // Parts of an upload that never completed are invisible in the
        // console and billed like anything else.
        id: "abort-incomplete-uploads",
        enabled: true,
        abortIncompleteMultipartUploadAfter: Duration.days(7),
      },
    ],
  });
}
