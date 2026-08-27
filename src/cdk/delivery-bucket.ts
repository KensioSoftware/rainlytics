// What a Rainlytics log delivery needs of the bucket it writes into, and the
// one thing the pair of values can get wrong.

import type { IKey } from "aws-cdk-lib/aws-kms";
import { Token } from "aws-cdk-lib/core";

/**
 * What a log delivery needs of a log bucket, which is an ARN, a name and
 * whatever key encrypts it.
 *
 * Deliberately narrower than `IBucket`. Under `exactOptionalPropertyTypes`,
 * CDK's own `Bucket` is not assignable to `IBucket`, because the interface
 * declares `isWebsite?: boolean` where the class declares
 * `isWebsite: boolean | undefined`. A consumer with that compiler option on
 * therefore cannot pass the bucket they just made. Asking for the two things
 * actually read sidesteps that, and says what the dependency really is.
 *
 * `IBucket` and `Bucket` both satisfy it.
 */
export interface LogDeliveryBucket {
  /** The bucket's ARN, which the delivery destination is built from. */
  readonly bucketArn: string;

  /**
   * The bucket's name, which an Athena table's `s3://` location is built
   * from.
   *
   * Read here rather than pulled out of the ARN with `Fn::Select` over a
   * `Fn::Split`, because the location has to be legible in the template
   * somebody reads when a query comes back empty.
   */
  readonly bucketName: string;

  /** The key encrypting it, where it is encrypted with one. */
  readonly encryptionKey?: IKey | undefined;
}

/**
 * Refuses a log bucket whose name and ARN name different buckets.
 *
 * {@link LogDeliveryBucket} is structural, so a caller can assemble one by
 * hand out of two literals. The delivery writes to the ARN and an Athena
 * table over it reads the name, and a pair that disagree therefore split the
 * dataset in two. CloudFront fills a bucket nothing queries, Athena reads a
 * bucket nothing writes, and both halves report success.
 *
 * `IBucket` and `Bucket` carry tokens for both, resolved at deploy time out
 * of the same bucket, so there is nothing to compare and nothing that can
 * disagree. Only a pair of literals is checked.
 *
 * @throws {Error} where the two name different buckets.
 */
export function assertOneBucket(bucket: LogDeliveryBucket): void {
  if (
    Token.isUnresolved(bucket.bucketArn) ||
    Token.isUnresolved(bucket.bucketName)
  ) {
    return;
  }

  if (!bucket.bucketArn.endsWith(`:${bucket.bucketName}`)) {
    throw new Error(
      `Log bucket "${bucket.bucketName}" does not match its ARN` +
        ` "${bucket.bucketArn}". The delivery writes to the ARN and the` +
        ` Athena table reads the name, so a pair that disagree deliver logs` +
        ` to one bucket and query another.`,
    );
  }
}
