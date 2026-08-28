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

Versioning is on. A deleted object leaves a version behind and can be got back.

Three lifecycle rules run. Objects expire after a year. Superseded versions and the delete markers
over them go thirty days after that. Multipart uploads that never completed are aborted after seven
days (those parts are invisible in the console and billed like anything else).

## The delivery grant

The bucket policy lets `delivery.logs.amazonaws.com` put objects, scoped to your account and to
delivery sources in us-east-1.

AWS adds that statement itself when logging is enabled. Carrying it here therefore looks redundant.
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

### It is also how long the addresses are kept

The delivered field set includes `c-ip`. What expires here is therefore a record of people as well
as of requests. Rainlytics counts unique visitors by hashing the viewer's address and their user
agent under a salt that rotates daily, and a scheduled rollup computes that hash from the address
the object already carries. The [log delivery](../log-delivery/) page covers the field set, and
[Counting visitors](../visitors/) covers the hash.

A year was chosen for a store of requests, and
[#73](https://github.com/KensioSoftware/rainlytics/issues/73) looked at it again for a store that
holds addresses and kept it. S3 expires objects and never columns. The shortest expiry that would
shed the addresses also throws away the request history every rollup is rebuilt from, and a year is
the right answer for that history.

So the choice is the site's, and there are two ways to take it. Passing `retention` shortens how
long the addresses are held, and shortens the recomputable history by the same amount. Leaving
`c-ip` out of the delivery's `fields` keeps the year and gives up the visitor count. The [log
delivery](../log-delivery/) page has the second one.

Whichever number you land on, the recovery window below adds itself to it. An address delivered
today is gone at 395 days on the defaults.

## Versioning, and the window it opens

The bucket is versioned. A deletion writes a delete marker over the object and keeps the version
underneath. Removing the marker brings the object back. Every derived dataset is rebuilt from this
store, so it is the one place where a deletion has to be reversible.

Versioning is also a prerequisite for AWS Backup. That service refuses an S3 bucket without it. An
immutable off-bucket copy starts here.

A log bucket usually leaves versioning off, on the grounds that a version history doubles the store.
That argument applies to a store somebody writes to twice. The delivery service writes each object
once and leaves it alone. An object here reaches its expiry with one version. Only two things ever
become superseded, the version an expiry leaves behind and the version a deletion leaves behind, and
`expire-superseded-logs` clears both.

```typescript
new LogBucket(this, "RainlyticsLogs", {
  recoveryWindow: Duration.days(90),
});
```

Thirty days by default. It is the window in which a deletion can be undone, and it is added to the
retention above rather than taken out of it. An object expires at 365 days, becomes superseded, and
goes for good at 395.

The raw store is read by the rollups, and the rollups are read by a person. That puts weeks between
something deleting an object and somebody noticing. Thirty days covers those weeks at a storage cost
of a month of logs against a year of them. Lengthen it on a site whose raw store is looked at less
often.

### The rule cannot be folded into the expiry

S3 refuses a lifecycle rule that carries both an expiry in days and `ExpiredObjectDeleteMarker`, and
CDK refuses the combination at synthesis. So `expire-raw-logs` holds the expiry and
`expire-superseded-logs` holds the clean-up, and the two cannot be one rule however much they look
like one.

Dropping the delete marker clean-up is the failure worth naming, and it happens quietly. Every
expired object then leaves a marker behind for good. A marker costs little and it costs something,
and a `ListObjectVersions` over a million of them is slow.

## Deliberate omissions

**No transition to Infrequent Access or Glacier.** This is the usual reflex for a log bucket and it
costs money here. S3 Standard-IA bills a minimum of 128KB per object, and CloudFront log objects on
a quiet site are frequently smaller than that. The cheaper per-GB rate then applies to several times
the bytes actually stored. Expiry does the work instead.

**No SSE-KMS by default.** Pass `encryptionKey` to opt in. KMS charges per request. A log bucket is
written to constantly and read by every query, which puts that charge at both ends and grows it with
use. The key policy also has to grant `delivery.logs.amazonaws.com` the `Encrypt`, `Decrypt`,
`ReEncrypt*`, `GenerateDataKey*` and `DescribeKey` actions, or delivery fails in a way the bucket
gives no sign of.

A customer-managed key also costs money for existing. AWS charges about $1 a month per key (a flat
charge, billed a day at a time) whatever the traffic, from the moment the key is created. In the
account the cost spike ran in, `us-east-1-KMS-Keys` bills between $0.028 and $0.032 a day for keys
that have nothing to do with Rainlytics. Everything else on this page is priced by use. Twenty hours
of real delivery from a site serving around 156,000 requests a day put this bucket's PUT requests
and storage together under a tenth of a dollar a month, and one key costs more than ten times that.
Passing `encryptionKey` is the one way to put a standing monthly charge into a pipeline built to
have none.

## Bucket names

A CloudFront delivery destination accepts a bucket name of lowercase letters, digits and hyphens. S3
itself also allows dots, so `logs.example.com` creates a bucket and then fails when the delivery is
pointed at it. The construct refuses such a name at synthesis instead.

## Permissions for a scoped deploy role

Skippable on an account whose CloudFormation execution role holds `AdministratorAccess`. That is
what `cdk bootstrap` gives it by default. Where that role has been narrowed, it needs S3 permissions
on this bucket. A role holding the delivery permissions from the [log delivery](../log-delivery/)
page and nothing else fails on `s3:CreateBucket`.

```typescript
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

new PolicyStatement({
  sid: "TheLogBucket",
  actions: ["s3:*"],
  resources: [logBucketArn, `${logBucketArn}/*`],
});
```

`s3:*` is what the first site to run a narrowed role granted, and it is the only version of this
statement a deploy has proved. The bucket is the log store, and every S3 call this role could make
against it belongs to a deploy of the stack that owns it.

A shorter list has to cover what the construct configures. That is creating the bucket, its bucket
policy, lifecycle rules, the public access block, encryption, object ownership controls and tagging,
each with its `Get` and `Delete` counterpart. Six verb families before a single object is written.

Treat that list as inferred from reading the construct. Nobody has yet deployed this bucket with a
policy narrower than `s3:*`, so the list has never been tested against the failure it would cause.

The object ARN carries the same warning. It is in the statement above because it is in the one that
was deployed. Every action the construct configures is bucket-level, and a deploying role plausibly
needs `logBucketArn` on its own. `autoDeleteObjects` is the case to check before dropping it, since
the objects go through a custom resource holding a role of its own rather than through this one.

### Name the bucket if you are going to scope a policy to it

A bucket left unnamed is named by CloudFormation after the stack and the logical id, plus a suffix
that appears only once the bucket exists. The obvious way to reach that from a policy is a prefix
built from the stack name, and it has a trap in it.

S3 caps a bucket name at 63 characters, and CloudFormation fits a generated name to that by
truncating **both** the stack name and the logical id. A stack called `ChineseboostAnalyticsStack`
produced a bucket beginning `chineseboostanalyticsstac`, one character short. So
`arn:aws:s3:::chineseboostanalyticsstack-*` matched nothing, and the deploy failed on a bucket the
policy looked like it covered.

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

The CloudWatch Logs and CloudFront permissions the delivery needs are on the [log
delivery](../log-delivery/) page.

## When a deploy rolls back

The bucket outlives a failed deploy, and that is worth knowing before it happens.

CloudFormation undoes a failed deploy by deleting what it created. A resource marked to be retained
is kept instead, and this bucket is marked that way, so a rollback leaves it behind. It belongs to
no stack afterwards, so every later `cdk deploy` and `cdk destroy` leaves it where it is. The next
deploy makes a fresh bucket with a fresh generated name, and the account ends up holding two buckets
whose names differ only in the random suffix CloudFormation appends.

The stack knows which one is live:

```bash
aws cloudformation describe-stack-resources \
  --stack-name YourAnalyticsStack \
  --query "StackResources[?ResourceType=='AWS::S3::Bucket'].[LogicalResourceId,PhysicalResourceId]" \
  --output table
```

A Rainlytics bucket the command leaves out is an orphan, and two tells confirm it. The orphan is
empty, where the rollback happened before any logs arrived. It also carries no bucket policy,
because the policy is a separate resource that CloudFormation deletes rather than retains.

An empty bucket costs nothing, so leaving it alone is a reasonable answer. Deleting it needs
`s3:DeleteBucket`. An organisation's service control policy can refuse that whatever your IAM
grants, and the deletion is then somebody else's to do.

**This is why the bucket has no name by default.** Giving it one through `bucketName` turns a
rollback into a stuck stack. The retained bucket keeps that name, and the next deploy fails trying
to create a bucket that already exists. Recovering means deleting the retained bucket first, which
is the step an SCP may not let you take. A generated name sidesteps the whole problem, at the price
of the orphan described above.

Retaining the bucket is still the right default. A rollback that destroyed a year of raw logs would
be far worse than an empty bucket nobody deletes, and raw logs are what every derived dataset is
rebuilt from.

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
  recoveryWindow: Duration.days(30),
});
```
-->
