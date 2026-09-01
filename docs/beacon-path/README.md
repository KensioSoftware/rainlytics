# Beacon path

`BeaconPath` adds a first-party event collection route to an existing CloudFront distribution.

```typescript
import { BeaconPath } from "@kensio/rainlytics/cdk";

new BeaconPath(this, "BeaconPath", {
  distribution,
  origin,
});
```

The default route is `/_rainlytics`. A CloudFront Function returns 204 during viewer request, before
the cache or origin. CloudFront still records the request in its access log.

`distribution` must be the CDK `Distribution` that serves the measured site. Pass any existing site
origin. CloudFront requires an origin on every behavior, but a beacon request never reaches it.

## Request flow

The browser sends an event in the query string:

```text
GET /_rainlytics?v=1&e=route&p=%2Farticles%2F
```

CloudFront writes `cs-uri-query` independently of the cache key and origin forwarding settings. The
function ignores the payload and returns the same empty response for every matching request.

The event enters the same S3 objects, Glue table and Athena queries as normal page requests. There
is no separate ingestion API.

## Choose the path

Reserve a path for the beacon:

```typescript
new BeaconPath(this, "BeaconPath", {
  distribution,
  origin,
  path: "/_measure",
});
```

Pass the same value to `startBeacon` and to any beacon rollup request. Rainlytics rejects a path
without a leading slash or a path containing a query string.

Do not use a real page path. Each event would then look like a request for that page and could
download its body if the edge function were missing.

## Protocol and cache behavior

The path is HTTPS-only by default. Plain HTTP receives 403. A redirect would require a second
request, which is unreliable when the browser sends the event while leaving a page.

Change the policy only when the site requires it:

```typescript
import { ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";

new BeaconPath(this, "BeaconPath", {
  distribution,
  origin,
  viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
});
```

The default managed cache policy excludes query strings from the cache key. The function normally
ends the request before the cache, but the safe fallback is one cached path rather than one key per
event.

The response includes `cache-control: no-store`, which prevents a browser from satisfying a repeated
event from its own cache.

## Limits and cost

CloudFront accepts up to 8,192 bytes for the path and query string and 32,768 bytes for the complete
request. Events above either limit receive 414, and CloudFront drops their payload.

A viewer-request CloudFront Function costs $0.10 per million invocations at the documented standard
rate. CloudFront request and log storage charges also apply. Every charge scales with requests.

A cached origin object would avoid the function invocation charge, but it would require every site
origin to serve the object, allow occasional origin misses and inflate the cache hit ratio. The
function keeps all event handling at the edge.

## Logged result type

CloudFront records a successful event with status 204 and result type
`FunctionGeneratedResponse`. The cache hit ratio counts `Hit`, `RefreshHit` and `Miss` only.
`FunctionGeneratedResponse` therefore stays outside the ratio.

<!-- card
```typescript
new BeaconPath(this, "BeaconPath", {
  distribution,
  origin,
});
```
-->
