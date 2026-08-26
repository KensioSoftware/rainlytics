import type { LifecycleRule } from "aws-cdk-lib/aws-s3";
import { Duration } from "aws-cdk-lib/core";

import type { LogBucketProps } from "./log-bucket.js";

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
 * How long a superseded version is kept before S3 removes it for good.
 *
 * The window in which a deletion can be undone. A log object is written once
 * and never updated, so the only things that ever become superseded here are
 * the version left behind when {@link defaultLogRetention} expires an object,
 * and the version left behind when something deletes one. The first is
 * routine and the second is the case this exists for.
 *
 * Thirty days puts the whole of the storage cost at a rounding error (a month
 * of superseded logs against a year of current ones) while covering the gap
 * between a deletion and somebody noticing it. Nothing reads the raw store
 * daily. The rollups do, and a person reads the rollups.
 *
 * It also adds itself to the retention above. An object expires at 365 days,
 * becomes superseded, and goes for good 30 days after that.
 */
export const defaultRecoveryWindow = Duration.days(30);

/**
 * What S3 does to an object over its life.
 *
 * Out of the constructor because the three rules have to be read together to
 * make sense. The first stops deleting anything the moment versioning goes on,
 * the second is what deletes instead, and the third is about a thing the other
 * two never create.
 */
export function logLifecycleRules(props: LogBucketProps): LifecycleRule[] {
  return [
    {
      id: "expire-raw-logs",
      enabled: true,
      expiration: props.retention ?? defaultLogRetention,
    },
    {
      /*
       * The tail versioning leaves behind, and the reason the rule above
       * stopped deleting anything on its own.
       *
       * On a versioned bucket an expiry writes a delete marker over the
       * object and makes the object a superseded version. Neither goes
       * anywhere without this rule, so the bucket would grow by a year of
       * logs a year and never shrink.
       *
       * `expiredObjectDeleteMarker` clears a delete marker once the
       * version under it has gone, which is the state the two halves of
       * this rule leave an expired object in. Left out, the bucket keeps
       * a marker per object for ever. A marker is cheap and it costs
       * something, and a `ListObjectVersions` over a million is slow.
       *
       * It cannot go in the rule above. S3 refuses `ExpiredObjectDeleteMarker`
       * in a rule that also carries an expiry in days, and CDK refuses the
       * combination at synthesis.
       */
      id: "expire-superseded-logs",
      enabled: true,
      noncurrentVersionExpiration:
        props.recoveryWindow ?? defaultRecoveryWindow,
      expiredObjectDeleteMarker: true,
    },
    {
      // Parts of an upload that never completed are invisible in the
      // console and billed like anything else.
      id: "abort-incomplete-uploads",
      enabled: true,
      abortIncompleteMultipartUploadAfter: Duration.days(7),
    },
  ];
}
