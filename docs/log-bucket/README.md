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
S3-managed keys. Object ownership is `BucketOwnerEnforced`. That turns ACLs off while still
permitting the `bucket-owner-full-control` the delivery service writes with, and delivered objects
then belong to your account.

Two lifecycle rules run. Objects expire after a year, and multipart uploads that never completed are
aborted after seven days (those parts are invisible in the console and billed like anything else).

## The delivery grant

The bucket policy lets `delivery.logs.amazonaws.com` put objects, scoped to your account and to
delivery sources in us-east-1.

AWS adds that statement itself when logging is enabled, which makes carrying it here look redundant.
Requiring TLS puts CloudFormation in charge of this bucket policy, and CloudFormation writes
whatever the template says on every update. A statement added outside the template therefore lasts
until the next stack update touches the policy and then goes, taking log delivery with it and
reporting nothing.

The `s3:x-amz-acl` condition AWS documents is left out. This bucket has ACLs disabled, and a
`StringEquals` on a condition key the request never carries denies the write.

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

## Permissions for a scoped deploy role

Skippable on an account whose CloudFormation execution role holds `AdministratorAccess`, which is
what `cdk bootstrap` gives it by default. Where that role has been narrowed, it needs S3 permissions
on this bucket. A role holding the delivery permissions from the
[log delivery](../log-delivery/) page and nothing else fails on `s3:CreateBucket`.

```typescript
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

new PolicyStatement({
  sid: "TheLogBucket",
  actions: ["s3:*"],
  resources: [logBucketArn, `${logBucketArn}/*`],
});
```

`s3:*` because the bucket is the log store, and every S3 call this role could make against it
belongs to a deploy of the stack that owns it. Narrowing it means covering what the construct sets
up. That is creating the bucket, its bucket policy, lifecycle rules, the public access block,
encryption, object ownership controls and tagging. Six verb families before a single object is
written.

### Name the bucket if you are going to scope a policy to it

A bucket left unnamed is named by CloudFormation after the stack and the logical id, plus a suffix
that appears only once the bucket exists. The obvious way to reach that from a policy is a prefix
built from the stack name, and it has a trap in it.

S3 caps a bucket name at 63 characters, and CloudFormation fits a generated name to that by
truncating **both** the stack name and the logical id. A stack called
`ChineseboostAnalyticsStack` produced a bucket beginning `chineseboostanalyticsstac`, one character
short. So `arn:aws:s3:::chineseboostanalyticsstack-*` matched nothing, and the deploy failed on a
bucket the policy looked like it covered.

Passing `bucketName` avoids the whole question. The name is then yours, the policy can quote it, and
the two cannot drift:

```typescript
const logs = new LogBucket(this, "RainlyticsLogs", {
  bucketName: "example-com-rainlytics-logs",
});
```

Where the name stays generated, match a prefix short enough to survive truncation and check it
against the bucket that actually got created. The bucket is `RETAIN` by default, so its name
outlives the stack that made it.

The CloudWatch Logs and CloudFront permissions the delivery needs are on the
[log delivery](../log-delivery/) page.

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
