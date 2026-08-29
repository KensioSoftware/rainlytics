# Beacon path

Answers the beacon's collection path with a 204, at the edge. The construct adds a cache behaviour
to a distribution you already own and attaches a CloudFront Function to it. The request stops at
the edge, ahead of the cache and ahead of the origin, and CloudFront records it in the access log
like every other request. That record is the event.

```typescript
import { BeaconPath } from "@kensio/rainlytics/cdk";

new BeaconPath(this, "RainlyticsBeacon", { distribution, origin });
```

`distribution` is the one already serving the site. `origin` is whatever the rest of the site comes
from. Every CloudFront cache behaviour names an origin and no request reaches this one, so pass the
site's own.

The path defaults to `/_rainlytics`.

## How an event travels

The beacon puts its payload in the query string and sends a GET:

```text
GET /_rainlytics?v=1&e=route&p=%2Fliju%2F
```

CloudFront delivers `cs-uri-query` whatever the cache key and the origin forwarding are set to. The
payload lands in the same log objects, the same partitions and the same Glue table as every page
request. Layer 2 is more rows in the dataset layer 1 already writes, and that is what makes the
beacon nearly free. `src/beacon-events.ts` holds the envelope, and the [log table](../log-table/)
page has the columns.

The function reads none of it. It returns the same 204 to every request the behaviour matches, and
the payload travels past it into the log.

## The choice between a function and a cached object

An empty path can be answered two ways. A CloudFront Function on viewer-request returns a synthetic
204. A small object on the origin is served from the cache. Both carry the same CloudFront request
charge and the same log delivery, and the invocation charge below is the only difference between
them. [#99](https://github.com/KensioSoftware/rainlytics/issues/99) took the decision on three
things beside cost.

**Rainlytics can ship the function on its own.** The construct attaches a behaviour and a function
to a distribution you already own, whatever that distribution serves. A cached object needs
something to put a file at the path, which is either the site's build cooperating or Rainlytics
writing into an origin bucket it has been granted. A distribution in front of an ALB, an API or a
third party takes the function and has nowhere to put the object.

**A flood stays inside CloudFront.** The function answers at the edge and the origin never hears
about it. A cached object serves from cache until its TTL lapses, and the misses reach the origin,
bounded by points of presence times TTL. The collection path is unauthenticated by design. That is
the difference between an abusive client costing CloudFront requests and one arriving at the site
itself.

**The cache hit ratio stays honest.** `cache-hit-ratio` counts `Hit`, `RefreshHit` and `Miss`
alone. A cached object would count as a `Hit` on nearly every beacon request and lift the ratio for
the whole site. A generated response is none of the three.

## What it costs

CloudFront Functions are priced per invocation, at $0.10 per million. A viewer-request function runs
before the cache on every request the behaviour matches, so a million beacon events is a million
invocations and ten pence.

Beside that sit the CloudFront request charge and the log delivery, which a million page requests
pay anyway and which the cached object would pay too. Every charge here is per request, and a
quiet site pays for the requests it gets. Prices read from the CloudFront pricing page on
2026-08-29.

## The cache key leaves the query string out

The behaviour takes the managed `CachingOptimized` policy, which keys on the path alone.

A viewer-request function that returns a response ends the request before the cache is consulted,
which leaves this path with no cache entry to hold. The policy still matters. It is what the path
falls back to if the function is ever removed or fails to associate, and a policy carrying the query
string would make every event its own cache key and send every one of them to the origin. Keying on
the path collapses that same flood into a single entry.

Pass `cachePolicy` for a site that standardises on one of its own. Whatever it is, keep the query
string out of the key.

## How much fits in the URL

CloudFront accepts 8,192 bytes of path and query string together, and 32,768 bytes for the whole
request including its headers. Above either limit it answers 414 and the event is lost.

That leaves several kilobytes for a payload, against the 800 bytes `cf.logCustomData()` allows. It
is why the beacon carries its data in the URL and why no API Gateway and Lambda ingest endpoint is
in the design. Reach for `logCustomData` only where the value has to come from the function itself.

## Paths CloudFront would never match

A CloudFront path pattern may start with anything, and `*.jpg` is a normal one. A beacon path
written without its leading slash therefore deploys green and matches no request the beacon sends,
and the first sign of it is a dataset with no beacon rows in it.

The construct refuses that at synthesis, naming the path. It refuses one carrying a query string for
the same reason, since a pattern is matched against the path alone.

```typescript
new BeaconPath(this, "RainlyticsBeacon", {
  distribution,
  origin,
  path: "/_collect",
});
```

Give it a path the site keeps free. Pointing the beacon at a page would count every event as a
view of that page, and download the page body a second time.

## Browsers keep no copy of the answer

The function sends `cache-control: no-store`. The same event on the same page produces the same URL
twice, and a browser holding a cached 204 would answer the second one out of its own cache. That
event would reach no log.

## What a beacon row looks like in the log

One thing here is still unmeasured. The CloudFront documentation enumerates no `x-edge-result-type`
value for a response that a function generated. The published list runs `Hit`, `RefreshHit`, `Miss`,
`LimitExceeded`, `CapacityExceeded`, `Error`, `Redirect` and `LambdaExecutionError`. Read the value
off a deployed distribution before writing a query that depends on it. The note is on
[#99](https://github.com/KensioSoftware/rainlytics/issues/99).

Beacon rows also land in the status-code rollup as 204s. Anybody asking that question means to
count page requests.
[#103](https://github.com/KensioSoftware/rainlytics/issues/103) covers what to do with them, and
[#104](https://github.com/KensioSoftware/rainlytics/issues/104) covers filtering a spammed
collection path.

## Permissions for a scoped deploy role

Untested. An account still on the `AdministratorAccess` that `cdk bootstrap` gives the
CloudFormation execution role deploys this with no IAM work, and the reference site is one. A role
narrowed with `--cloudformation-execution-policies` is expected to need `cloudfront:CreateFunction`,
`cloudfront:DescribeFunction`, `cloudfront:PublishFunction` and `cloudfront:DeleteFunction` for the
function, plus `cloudfront:GetDistribution` and `cloudfront:UpdateDistribution` for the behaviour.
Treat that as a starting point for reading a denial. The [log delivery](../log-delivery/) page has
what happened when the same list was reasoned about rather than deployed.

<!-- card
```typescript
new BeaconPath(this, "RainlyticsBeacon", { distribution, origin });
```
-->
