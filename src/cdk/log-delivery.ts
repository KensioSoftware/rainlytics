import {
  CfnDelivery,
  CfnDeliveryDestination,
  CfnDeliverySource,
} from "aws-cdk-lib/aws-logs";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { Stack } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import {
  defaultPartitionGranularity,
  type PartitionGranularity,
} from "../partition-keys.js";
import { deliveredLogFieldNames } from "../log-fields.js";
import { deliverySuffixPath } from "../partitions.js";
import { grantLogDeliveryKeyUse } from "./delivery-key-grant.js";
import { logDeliveryRegion } from "./delivery-region.js";
import { requireStackRegion } from "./stack-region.js";

/**
 * What this construct needs of a log bucket, which is an ARN and whatever
 * key encrypts it.
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

  /** The key encrypting it, where it is encrypted with one. */
  readonly encryptionKey?: IKey | undefined;
}

/** The formats CloudFront will write access logs in. */
export type LogOutputFormat = "json" | "plain" | "w3c" | "raw" | "parquet";

/** What a CloudFront log delivery needs telling. */
export interface CloudFrontLogDeliveryProps {
  /**
   * The distribution whose access logs are delivered.
   *
   * A string rather than an `IDistribution`, because the distribution almost
   * never lives in this stack. Delivery is configured from us-east-1 and a
   * site's distribution is usually declared wherever the rest of its
   * infrastructure is, so passing `distribution.distributionId` across
   * regions would need CDK's cross-region references and the custom
   * resources that come with them. A literal id works without any of that.
   */
  readonly distributionId: string;

  /** Where the logs land. {@link LogBucket} makes a suitable one. */
  readonly logBucket: LogDeliveryBucket;

  /**
   * The prefix inside the bucket that the partitions start under.
   *
   * Changing this later splits the dataset, since what was already written
   * stays where it was written.
   *
   * @default "rainlytics"
   */
  readonly prefix?: string | undefined;

  /**
   * The format CloudFront writes the log objects in.
   *
   * JSON by default. Parquet is the obvious choice for a dataset Athena
   * reads and it carries a CloudWatch conversion charge whose size is not
   * documented, so it stays something to opt into with numbers in hand. See
   * KensioSoftware/rainlytics#9.
   *
   * This can only be set when the delivery destination is created. Changing
   * it replaces the destination rather than updating it.
   *
   * @default "json"
   */
  readonly outputFormat?: LogOutputFormat | undefined;

  /**
   * How finely the delivered logs are partitioned by time.
   *
   * @default hourly
   */
  readonly granularity?: PartitionGranularity | undefined;

  /**
   * The log fields delivered.
   *
   * @default the Rainlytics field set, which is the minimum the rollups need
   */
  readonly fields?: readonly string[] | undefined;

  /**
   * A name for the delivery source, unique within the account.
   *
   * @default `rainlytics-${distributionId}`
   */
  readonly deliveryName?: string | undefined;
}

/**
 * Delivers a CloudFront distribution's access logs into an S3 bucket, in the
 * partition layout and field set the rest of Rainlytics reads.
 *
 * Must be in a us-east-1 stack. Two things about this are worth knowing
 * before you deploy it.
 *
 * A distribution can carry only one delivery source. A second fails with
 * "This ResourceId has already been used in another Delivery Source in this
 * account", so a distribution that already has standard logging v2 enabled
 * has to give it up first.
 *
 * Logging changes take up to twelve hours to take effect, so a successful
 * deploy is not the same as logs arriving.
 */
export class CloudFrontLogDelivery extends Construct {
  /** The delivery source, one per distribution. */
  readonly source: CfnDeliverySource;

  /** Where the logs are delivered, being the bucket and the prefix. */
  readonly destination: CfnDeliveryDestination;

  /** What joins the two. */
  readonly delivery: CfnDelivery;

  constructor(scope: Construct, id: string, props: CloudFrontLogDeliveryProps) {
    super(scope, id);

    requireStackRegion(this, logDeliveryRegion);

    const stack = Stack.of(this);
    const name = props.deliveryName ?? `rainlytics-${props.distributionId}`;
    const prefix = props.prefix ?? "rainlytics";

    this.source = new CfnDeliverySource(this, "Source", {
      name,
      logType: "ACCESS_LOGS",
      resourceArn: stack.formatArn({
        service: "cloudfront",
        region: "",
        resource: "distribution",
        resourceName: props.distributionId,
      }),
    });

    this.destination = new CfnDeliveryDestination(this, "Destination", {
      name,
      destinationResourceArn: `${props.logBucket.bucketArn}/${prefix}`,
      outputFormat: props.outputFormat ?? "json",
    });

    this.delivery = new CfnDelivery(this, "Delivery", {
      deliverySourceName: this.source.name,
      deliveryDestinationArn: this.destination.attrArn,
      s3EnableHiveCompatiblePath: true,
      s3SuffixPath: deliverySuffixPath(
        props.granularity ?? defaultPartitionGranularity,
      ),
      recordFields: [...(props.fields ?? deliveredLogFieldNames)],
    });
    this.delivery.addResourceDependency(this.source);
    this.delivery.addResourceDependency(this.destination);

    const key = props.logBucket.encryptionKey;
    if (key !== undefined) {
      grantLogDeliveryKeyUse(this, key, logDeliveryRegion);
    }
  }
}
