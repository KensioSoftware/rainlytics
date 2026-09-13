# Collection-path abuse

The browser collection path is public. Any client can send requests to it and invent event names,
pages and values.

This risk also exists for access-log pageviews. A client can request a real page repeatedly and
create valid-looking rows. Server logs record requests. A request alone provides no proof that a
person read the response.

## Protect the reported count

The `beaconEvents` rollup caps one visitor's identical events at 60 per hour. The standard bot
filter also removes clients that identify themselves with common crawler names.

The filters apply when Athena computes the result. All requests remain in the raw log. If abuse
distorts a report, you can adjust the query and recompute it while those logs are still available.

A client can avoid the cap by rotating addresses, user agents, pages or event names. Treat event
counts as signals from an open endpoint.

## Understand request costs

Every abusive request can incur:

- a CloudFront request and CloudFront Function invocation
- S3 request and storage cost for the delivered log record
- Athena scan cost whenever a query reads the affected partition

Filtering later changes the report only. The Athena workgroup limits one query's scan. CloudFront
and S3 charges remain outside that limit.

Under pay-as-you-go pricing, a large request flood can increase the bill even when those requests
are excluded from every report. A CloudFront flat-rate plan has different allowances and included
protections. Check the plan attached to your distribution.

## Add WAF when its fixed cost is justified

AWS WAF can keep request counts at the edge and apply a rate-based rule to the collection path. A
new web ACL has a monthly charge, each rule has another monthly charge, and request inspection is
also billed.

At [standard WAF rates](https://aws.amazon.com/waf/pricing/), one web ACL and one rate-based rule
cost $6 per month before request charges. This can exceed a quiet site's log-storage cost.
Configure WAF in the site's CDK app if the protection justifies that cost.

WAF is cheaper to add when the distribution already has a web ACL. Define the rule in the site's
own CDK app and scope it to `defaultBeaconPath` or the custom path passed to `BeaconPath`.

CloudFront Functions start each request without writable state, so they cannot implement a counter.
CloudFront KeyValueStore is read-only from function code. AWS Shield Standard protects the network
layer. Application-level rate limiting requires WAF.

## Monitor spend

Create an AWS Budget for the account or workload and alert above its normal monthly range.
[Budget monitoring and notifications are free](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/).
Automatic budget actions and scheduled budget reports have separate pricing.

A budget can track CloudFront, function, storage and query costs together. Its alerts notify you
of spending changes. They do not block incoming requests or impose a spending cap.

<!-- card
```text
The collection path is public.
Filter counts, cap Athena scans and monitor the AWS bill.
```
-->
