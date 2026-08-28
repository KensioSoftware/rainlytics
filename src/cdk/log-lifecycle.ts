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
 *
 * A year now also covers the viewer's address. KensioSoftware/rainlytics#53
 * put `c-ip` in the delivered field set to count unique visitors, and
 * KensioSoftware/rainlytics#73 looked at this number again for a store that
 * holds one. It stays at a year, for three reasons.
 *
 * The address is one column of an object that also holds everything else
 * about those requests. S3 expires objects and never columns. An expiry short
 * enough to shed the addresses takes the request history with it, and that
 * history is what every rollup is rebuilt from. The lifetime worth shortening
 * is the one lifetime that cannot be shortened on its own.
 *
 * Lowering the default would then delete history on sites already running
 * Rainlytics, on the first deploy after an upgrade, having asked nobody. A
 * version bump should not quietly discard data that cannot be recovered.
 *
 * And the choice belongs to the site. Passing `retention` shortens how long
 * the addresses are held, and shortens how far back a rollup can be
 * recomputed with it. Leaving `c-ip` out of the delivery's `fields` keeps the
 * year and gives up the visitor count. `docs/log-bucket/` sets both out for
 * whoever runs the site, which is where the decision belongs.
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
 * becomes superseded, and goes for good 30 days after that. That is the
 * number to quote for how long the raw store holds a viewer's address. It is
 * 395 days on the defaults, and KensioSoftware/rainlytics#73 kept both halves
 * of it.
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
