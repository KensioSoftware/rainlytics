# Log bucket

`LogBucket` creates the S3 bucket that stores raw CloudFront access logs.

```typescript
import { LogBucket } from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "Logs");
```

Pass `logs.bucket` to `CloudFrontLogDelivery`. Every summary and report can be rebuilt from the
objects in this bucket.

## Defaults

The bucket has these settings:

- public access is blocked
- TLS is required
- S3-managed encryption is enabled
- object ownership is `BucketOwnerEnforced`
- versioning is enabled
- raw objects expire after 370 days
- noncurrent versions expire after another 30 days
- incomplete multipart uploads stop after 7 days
- CloudFormation retains the bucket when the stack is deleted

The bucket policy allows `delivery.logs.amazonaws.com` to write from delivery sources in your
account. Rainlytics manages this statement in the template because a later CloudFormation update
could remove a policy statement added outside the stack.

## Choose a retention period

Raw log retention limits how far back Rainlytics can recompute an answer. The 370-day default
supports an annual report and gives the scheduled job time to rebuild it.

```typescript
import { Duration } from "aws-cdk-lib";

const logs = new LogBucket(this, "Logs", {
  retention: Duration.days(730),
});
```

The default delivery includes the viewer address. Retention therefore applies to personal data as
well as request data. Use a shorter period if you need to remove both sooner. Use
`logFieldNamesWithoutAddress` on the delivery if you want to keep request history without storing
viewer addresses. That option disables visitor counts.

See [Counting visitors](../visitors/) for the full data model.

## Recover deleted logs

Versioning keeps a deleted or expired object as a noncurrent version for 30 days. Change this with
`recoveryWindow`:

```typescript
const logs = new LogBucket(this, "Logs", {
  recoveryWindow: Duration.days(90),
});
```

The recovery window starts after normal retention. With the defaults, an object can remain in S3
for up to 400 days.

CloudFront writes each log object once. Versioning therefore adds little storage during normal use.
It mainly protects against deletion and supports AWS Backup.

## Use a customer-managed KMS key

S3-managed encryption has no key charge or per-request KMS charge. Pass `encryptionKey` when your
policy requires a customer-managed key:

```typescript
const logs = new LogBucket(this, "Logs", {
  encryptionKey,
});
```

Rainlytics grants the log delivery service access when CDK can update the key policy. An imported
key from another stack may require a policy statement in the stack that owns the key. Check the CDK
warning produced during synthesis.

A customer-managed key has a monthly key charge and request charges. This adds fixed and
usage-based costs that the default avoids.

## Name the bucket only when required

CloudFormation generates a bucket name by default. A named bucket makes IAM scoping easier:

```typescript
const logs = new LogBucket(this, "Logs", {
  bucketName: "example-com-rainlytics-logs",
});
```

The delivery destination accepts lowercase letters, digits and hyphens. Rainlytics rejects names
with dots even though S3 accepts them.

A retained named bucket can block a retry after a failed deployment because the next stack cannot
create another bucket with the same name. Generated names avoid that problem. A rollback may leave
an empty retained bucket behind, but it does not prevent the next deployment.

## Delete the bucket with the stack

Raw logs are retained by default. To delete them with the stack, set both options:

```typescript
import { RemovalPolicy } from "aws-cdk-lib";

const logs = new LogBucket(this, "Logs", {
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});
```

`RemovalPolicy.DESTROY` alone fails when the bucket contains objects. `autoDeleteObjects` removes
every current and noncurrent object before CloudFormation deletes the bucket.

## Deployment permissions

The standard CDK bootstrap role has enough permission. A restricted CloudFormation execution role
needs S3 management permission for the bucket and its objects. The deployed configuration uses
bucket policy, lifecycle, encryption, ownership, public-access and tagging APIs.

Give a restricted role a stable bucket name before scoping its policy. CloudFormation truncates
generated names, so a policy built from the full stack name can miss the bucket it created.

<!-- card
```typescript
const logs = new LogBucket(this, "Logs");
```
-->
