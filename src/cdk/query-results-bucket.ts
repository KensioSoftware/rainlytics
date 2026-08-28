// Where Athena puts what a query answered.

import type { IKey } from "aws-cdk-lib/aws-kms";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { Duration, RemovalPolicy } from "aws-cdk-lib/core";
import type { Construct } from "constructs";

import { defaultResultsRetention } from "./query-cost.js";
import type { QueryWorkgroupProps } from "./query-workgroup.js";

/**
 * What a policy statement needs of the results bucket, which is an ARN and
 * whatever key encrypts it.
 *
 * Narrower than `IBucket`, for the reason `LogDeliveryBucket` sets out. The
 * bucket below is created with S3-managed keys and has no key to hand out.
 * The shape carries one anyway, so a statement over a results bucket
 * somebody else made reads the same way the log bucket's does.
 */
export interface QueryResultsBucket {
  /** The bucket's ARN, which the statement is scoped to. */
  readonly bucketArn: string;

  /** The key encrypting it, where it is encrypted with one. */
  readonly encryptionKey?: IKey | undefined;
}

/**
 * The bucket Athena writes a query's results into.
 *
 * Unversioned, unlike the log bucket. A result is derived data that the
 * query which produced it can produce again, so there is nothing here worth
 * being able to undelete, and a version history would double the cost of
 * the one thing in this pipeline nobody reads twice.
 */
export function queryResultsBucket(
  scope: Construct,
  props: QueryWorkgroupProps,
): Bucket {
  return new Bucket(scope, "Results", {
    ...(props.resultsBucketName === undefined
      ? {}
      : { bucketName: props.resultsBucketName }),
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
        id: "expire-query-results",
        enabled: true,
        expiration: props.resultsRetention ?? defaultResultsRetention,
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
}
