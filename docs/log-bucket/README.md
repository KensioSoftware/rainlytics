# Log bucket

The S3 bucket CloudFront delivers raw access logs into, and the first thing a Rainlytics pipeline
needs. Everything else is derived from what lands here.

```typescript
import { Duration } from "aws-cdk-lib/core";
import { LogBucket } from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "RainlyticsLogs", {
  bucketName: "example-com-rainlytics-logs",
});
```

`logs.bucket` is the bucket, for the delivery to be pointed at.

## What it sets up

Public access is blocked on all four switches, TLS is required, and objects are encrypted with
S3-managed keys. Object ownership is `BucketOwnerEnforced`, which turns ACLs off while still
permitting the `bucket-owner-full-control` the delivery service writes with, so delivered objects
belong to your account rather than to AWS.

Two lifecycle rules run. Objects expire after a year, and multipart uploads that never completed are
aborted after seven days (those parts are invisible in the console and billed like anything else).

## The delivery grant

The bucket policy lets `delivery.logs.amazonaws.com` put objects, scoped to your account and to
delivery sources in us-east-1.

AWS adds that statement itself when logging is enabled, so carrying it here looks redundant.
It is not. Requiring TLS makes CloudFormation the owner of this bucket policy, and CloudFormation
writes whatever the template says on every update, so a statement added outside the template lasts
until the next stack update touches the policy and then goes, taking log delivery with it and
reporting nothing.

The `s3:x-amz-acl` condition AWS documents is left out. This bucket has ACLs disabled, and a
`StringEquals` on a condition key the request never carries denies the write rather than allowing
it.

## Retention is the limit on what can be recomputed

Raw logs are the immutable record, and every rollup and summary is rebuilt from them. The expiry
rule is therefore the furthest back any future question can reach. A year is the default because it
covers a year-on-year comparison and costs little at the traffic Rainlytics is built for.

```typescript
new LogBucket(this, "RainlyticsLogs", {
  retention: Duration.days(730),
});
```

`Duration` comes from `aws-cdk-lib/core`.

Shortening it discards history that cannot be recovered afterwards.

## Deliberate omissions

**No transition to Infrequent Access or Glacier.** This is the usual reflex for a log bucket and it
costs money here. S3 Standard-IA bills a minimum of 128KB per object, and CloudFront log objects on
a quiet site are frequently smaller than that. The cheaper per-GB rate then applies to several times
the bytes actually stored. Expiry does the work instead.

**No versioning.** Objects are written once by a service and never updated. A version history would
hold one version of everything and charge for it.

**No SSE-KMS by default.** Pass `encryptionKey` to opt in. KMS charges per request. A log bucket is
written to constantly and read by every query, which puts that charge at both ends and grows it with
use. The key policy also has to grant `delivery.logs.amazonaws.com` the `Encrypt`, `Decrypt`,
`ReEncrypt*`, `GenerateDataKey*` and `DescribeKey` actions, or delivery fails in a way the bucket
gives no sign of.

## Bucket names

A CloudFront delivery destination accepts a bucket name of lowercase letters, digits and hyphens. S3
itself also allows dots, so `logs.example.com` creates a bucket and then fails when the delivery is
pointed at it. The construct refuses such a name at synthesis instead.

## Removal

The bucket is retained when its stack is destroyed, so `cdk destroy` never takes the analytics
history with it. Pass `removalPolicy` to change that.

A bucket that still holds objects refuses to be deleted, so `RemovalPolicy.DESTROY` on its own turns
`cdk destroy` into a CloudFormation failure rather than a deletion. `autoDeleteObjects` empties it
first. That is off by default and is not implied by the removal policy, because what it deletes is
the raw record everything else is rebuilt from.

```typescript
new LogBucket(this, "RainlyticsLogs", {
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});
```

<!-- card
```typescript
new LogBucket(this, "RainlyticsLogs", {
  bucketName: "example-com-rainlytics-logs",
  retention: Duration.days(365),
});
```
-->
