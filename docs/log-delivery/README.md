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

Fields default to the Rainlytics set, which is twelve fields and the minimum the rollups need.
Partitions are hourly by default, Hive-compatible, and land under a `rainlytics` prefix inside the
bucket. Changing the prefix later splits the dataset, because what was already written stays where
it was written.

Objects arrive under the partition keys CloudFront derives from that layout:

```text
s3://your-log-bucket/rainlytics/distributionid=E1EXAMPLE1234/year=2026/month=08/day=25/hour=14/
```

Rainlytics sends the suffix path as bare variables (`{distributionid}/{yyyy}/{MM}/{dd}/{HH}`).
CloudFront supplies the `year=` half of each segment itself, because the delivery carries the
Hive-compatible option. A suffix path that has already added those key names is refused outright,
with `Provided suffixPath is invalid`.

## The field set holds the viewer's address

`c-ip` is one of the twelve. Rainlytics counts unique visitors as a hash of the viewer's address and
their user agent, under a salt that rotates every day, and a scheduled rollup computes that hash
from the address the log already holds. The reasoning is on
[#53](https://github.com/KensioSoftware/rainlytics/issues/53), in the comments, and
[Counting visitors](../visitors/) has what the number means and where the salt lives.

The raw store is therefore a record of people as well as of requests. Hashing downstream leaves the
addresses where they landed. CloudFront writes an object once and leaves it alone, and the addresses
last exactly as long as the log objects do. On the defaults that is 365 days, plus the 30 days a
superseded version survives, and the [log bucket](../log-bucket/) page has both numbers and how to
change them.

A site that would rather not keep addresses can deliver everything else:

```typescript
import { deliveredLogFieldNames } from "@kensio/rainlytics";

new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
  fields: deliveredLogFieldNames.filter((field) => field !== "c-ip"),
});
```

Pageviews, referrers, devices, status codes and geography all carry on. The visitor count is the one
thing that stops being computable, and no later job can recover it for the days the field was
absent. Geography survives because CloudFront resolves `c-country` at the edge from an address the
log then never records.

## The first visitor counts cover part of a day

A logging change takes up to twelve hours to apply, and it covers what CloudFront writes from then
on. The objects already in the bucket keep the shape they were written with, and the address is
absent from every record in them. A visitor count over a day that spans the change covers only the
part of the day with addresses in it. It reads low, and the answer looks like any other. Give it a
full day of delivered records before reading one day against another.

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
CloudFront permission is checked on the caller. Establishing that list took three failed deploys on
the first site to run a narrowed role. The three headings below are the three failures, in the order
they arrived.

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

`"*"` is what has been deployed, and it is wider than it has to be. CloudWatch Logs supports
resource-level permissions on most of these actions, against `delivery-source`,
`delivery-destination` and `delivery` ARNs. A `Put` names the resource it is about, and a wildcard
such as `arn:aws:logs:us-east-1:<account>:delivery-source:*` therefore matches the call that creates
one.

Narrowing it is more work than that makes it sound. `DescribeDeliverySources` and
`DescribeDeliveries` support no resource type and stay on `"*"`. `CreateDelivery` is authorised
against all three resource types at once, and so are the tagging actions.
Check each action in the [service authorization
reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncloudwatchlogs.html)
before scoping, and deploy the result before believing it. Nothing here has been run against a
scoped version of this statement.

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

```text
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

Scoped to the distribution. That is unusual for a `cloudfront:` action, and possible here because
the distribution has been serving the site for as long as it takes to know its id. A CloudFront ARN
carries no region.

This one was reasoned about first and got wrong. The argument ran that v2 names the distribution by
ARN and CloudWatch Logs checks ownership on its own side, leaving the caller with no reason to hold
a `cloudfront:` action. A deploy said otherwise.

The lesson generalises past this action. A permission that one service checks on another's behalf
cannot be worked out from the API surface, because the API being called is the wrong place to look
for it. Read the denial and grant what it names.

### The bucket the delivery writes into needs its own permissions

The third deploy failed on `s3:CreateBucket`. That is the permission a reader of this page is most
likely to miss. Nothing above mentions S3, and a role assembled from this section alone gets as far
as creating the bucket and stops.

[`LogBucket`](../log-bucket/) is a separate construct in the same stack, and the deploying role
needs the bucket verbs as well as the delivery ones. They are on the [log bucket](../log-bucket/)
page, along with a warning about scoping them to a generated bucket name.

### Widening the policy can be a deploy of its own

Where the execution policy is itself managed by CDK, it usually lives in a different stack from the
one it governs, and sometimes in a different region. Editing it and rerunning the deploy that needed
it then changes nothing, because the policy stack has to go first.

The failure that follows looks the same as the one just fixed. A reader who has added the missing
action and redeployed can reasonably conclude the action was wrong, when the policy carrying it was
never applied.

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
