# Collection-path abuse

The browser collection path is public. Any client can send requests to it and invent event names,
pages and values.

This risk also exists for access-log pageviews. A client can request a real page repeatedly and
create valid-looking rows. Server logs record requests. A request alone provides no proof that a
person read the response.

## Protect the reported count

The `beaconEvents` rollup caps one visitor's identical events at 60 per hour. The standard bot
filter also removes clients that identify themselves with common crawler names.

These rules protect the derived count. They do not remove requests from the raw log. You can change
a query and recompute a poisoned window while its raw objects still exist.

A client can avoid the cap by rotating addresses, user agents, pages or event names. Treat event
counts as signals from an open endpoint.

## Request cost is final

Every abusive request can incur:

- a CloudFront request and CloudFront Function invocation
- S3 request and storage cost for the delivered log record
- Athena scan cost whenever a query reads the affected partition

Filtering later changes the report only. The Athena workgroup limits one query's scan. CloudFront
and S3 charges remain outside that limit.

Every component is usage-priced. A large request flood therefore creates a large variable bill even
though the normal deployment has no fixed monthly capacity.

## Add WAF when its fixed cost is justified

AWS WAF can keep request counts at the edge and apply a rate-based rule to the collection path. A
new web ACL has a monthly charge, each rule has another monthly charge, and request inspection is
also billed.

At the standard published rates used by the project, one web ACL and one rate-based rule begin at
$6 per month before request charges. This is much larger than the normal log-storage cost of a quiet
site. Rainlytics therefore leaves WAF configuration to the site.

WAF is cheaper to add when the distribution already has a web ACL. Define the rule in the site's
own CDK app and scope it to `defaultBeaconPath` or the custom path passed to `BeaconPath`.

CloudFront Functions start each request without writable state, so they cannot implement a counter.
CloudFront KeyValueStore is read-only from function code. AWS Shield Standard protects the network
layer. Application-level rate limiting requires WAF.

## Monitor spend

Create an AWS Budget for the account or workload and alert above its normal monthly range. The first
two AWS Budgets in an account have no charge under the standard pricing described by AWS.

A budget alert detects CloudFront, function, storage and query growth together. Use the resulting
traffic and cost data to decide whether a WAF rule is worth its monthly floor.

<!-- card
```text
The collection path is public.
Filter counts, cap Athena scans and monitor the AWS bill.
```
-->
