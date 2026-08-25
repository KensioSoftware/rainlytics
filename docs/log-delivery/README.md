# Log delivery

Sends a CloudFront distribution's access logs into a Rainlytics log bucket, partitioned and with the
field set the rollups read. This is the piece that turns a bucket into a pipeline.

```typescript
import { CloudFrontLogDelivery, LogBucket } from "@kensio/rainlytics/cdk";

const logs = new LogBucket(this, "RainlyticsLogs");

new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});
```

## It has to live in us-east-1

Standard logging v2 is configured through the CloudWatch Logs API, and that API only accepts these
calls in us-east-1 whatever region the bucket is in. The construct refuses to synthesise anywhere
else, naming the stack.

Most sites keep their distribution somewhere else. That usually means a second stack:

```typescript
const delivery = new Stack(app, "RainlyticsDeliveryStack", {
  env: { account, region: "us-east-1" },
});
```

That is also why `distributionId` is a string rather than an `IDistribution`. Passing a construct
across regions needs CDK's cross-region references and the custom resources they bring with them. A
literal id needs neither. Pass `distribution.distributionId` if the two stacks are arranged so it
resolves.

## One delivery source per distribution

A distribution can carry a single delivery source. A second fails with `This ResourceId has already
been used in another Delivery Source in this account`. A distribution already running standard
logging v2 has to give that up before Rainlytics can take it over. Standard logging (legacy) is
separate and can keep running alongside.

## Logging changes take up to twelve hours

A successful deploy is not the same as logs arriving. CloudFront applies a logging change within
twelve hours. An empty bucket the morning after a deploy is the normal case at that point.

## Format, fields and partitions

Output is JSON. Parquet is the better shape for a dataset Athena reads, and it carries a CloudWatch
conversion charge that AWS documents only by name. It stays an opt-in until there are numbers to
justify it.

```typescript
new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
  outputFormat: "parquet",
  granularity: "daily",
});
```

The output format can only be set when the delivery destination is created. Changing it later
replaces the destination rather than updating it.

Fields default to the Rainlytics set, which is the minimum the rollups need. Partitions are hourly
by default, Hive-compatible, and land under a `rainlytics` prefix inside the bucket. Changing the
prefix later splits the dataset, because what was already written stays where it was written.

## Encrypted buckets

A bucket encrypted with a customer-managed key needs the delivery service allowed to use it. Without
that, the write is refused and the refusal appears in no log the bucket keeps. The construct adds
that grant, scoped to your account and its delivery sources, whenever the key is one CDK can reach.

An imported key is the exception. CDK cannot add a statement to a key policy belonging to another
template. The grant would be written and never applied. The construct emits a build warning instead,
and the statement to add by hand is on the [log bucket](../log-bucket/) page.

## Permissions for a scoped deploy role

`cdk bootstrap` gives the CloudFormation execution role `AdministratorAccess` unless told otherwise.
An account still on that default deploys this construct with no IAM work at all, and can stop
reading here. The rest of this section is for a role narrowed with `cdk bootstrap
--cloudformation-execution-policies`, where a missing action arrives as a rolled-back deploy.

Three `AWS::Logs::*` resources are created here (a delivery source naming the distribution, a
delivery destination naming the bucket and prefix, and a delivery joining the two), and one
CloudFront permission is checked on the caller.

### The CloudWatch Logs half

```typescript
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

new PolicyStatement({
  sid: "TheLogDelivery",
  actions: [
    "logs:PutDeliverySource",
    "logs:GetDeliverySource",
    "logs:DeleteDeliverySource",
    "logs:DescribeDeliverySources",
    "logs:PutDeliveryDestination",
    "logs:GetDeliveryDestination",
    "logs:DeleteDeliveryDestination",
    "logs:DescribeDeliveryDestinations",
    "logs:PutDeliveryDestinationPolicy",
    "logs:GetDeliveryDestinationPolicy",
    "logs:DeleteDeliveryDestinationPolicy",
    "logs:CreateDelivery",
    "logs:GetDelivery",
    "logs:DeleteDelivery",
    "logs:DescribeDeliveries",
    "logs:UpdateDeliveryConfiguration",
    "logs:TagResource",
    "logs:UntagResource",
    "logs:ListTagsForResource",
  ],
  resources: ["*"],
});
```

The action list is the whole of the scope here. A `Put` creates a source or destination whose ARN
exists only once the call returns. A resource scope would have no ARN to match against.

### Creates alone leave the stack stuck

The reads and the deletes are the half worth being deliberate about, and the half a hand-written
policy drops. CloudFormation reads with `Get` before every call it makes. A policy carrying only the
`Put` actions therefore fails before it has created anything.

Rollback then calls `Delete`, fails there too, and leaves the stack in `ROLLBACK_FAILED`. Clearing
that takes a hand `aws cloudformation delete-stack`. One missing verb family turns a failed deploy
into a stuck stack.

### The distribution has to allow it

Creating an `AWS::Logs::DeliverySource` calls CloudWatch Logs, and CloudWatch Logs then checks the
caller against CloudFront for the resource being logged. The denial therefore arrives from the
CloudWatch Logs API naming a CloudFront action:

```
User: .../cdk-hnb659fds-cfn-exec-role-<account>-us-east-1/AWSCloudFormation is not
authorized to perform: cloudfront:AllowVendedLogDeliveryForResource on resource:
arn:aws:cloudfront::<account>:distribution/E1EXAMPLE1234
(Service: CloudWatchLogs, Status Code: 400)
```

```typescript
new PolicyStatement({
  sid: "LogTheDistribution",
  actions: ["cloudfront:AllowVendedLogDeliveryForResource"],
  resources: [`arn:aws:cloudfront::${account}:distribution/E1EXAMPLE1234`],
});
```

Scoped to the distribution, which is unusual for a `cloudfront:` action and possible here because
the distribution has been serving the site for as long as it takes to know its id. A CloudFront ARN
carries no region.

This one was reasoned about first and got wrong. The argument ran that v2 names the distribution by
ARN and CloudWatch Logs checks ownership on its own side, leaving the caller with no reason to hold
a `cloudfront:` action. A deploy said otherwise. The lesson generalises past this action. A
resource type can call more than one service, and the second service is the one a policy misses.

### The bucket half

[`LogBucket`](../log-bucket/) needs S3 permissions of its own on the same role. Those are on the
[log bucket](../log-bucket/) page.

### SSE-KMS is unverified

Passing `encryptionKey` puts a customer-managed key in the stack, and the construct grants
`delivery.logs.amazonaws.com` the use of it (see above). Whether the _deploying role_ needs `kms:`
actions of its own for that has not been established either way. The only consumer so far encrypts
with S3-managed keys and has no evidence about the path.

The expectation, untested, is `kms:PutKeyPolicy` and `kms:GetKeyPolicy` on the key (CloudFormation
applies the grant by updating the key's policy), plus `kms:CreateKey`, `kms:DescribeKey`,
`kms:ScheduleKeyDeletion` and the tagging actions where the key is created in the same stack. Treat
that as a starting point for reading a denial, and not as a working policy.

<!-- card
```typescript
new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
});
```
-->
