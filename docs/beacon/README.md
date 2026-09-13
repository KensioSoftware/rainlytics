# Browser beacon

The browser beacon records route changes within a single-page app (SPA) and custom events such as
signups or purchases. These actions may not make a page request that CloudFront can log.

Deploy [Beacon path](../beacon-path/) first, then add the module to your site's existing JavaScript
bundle:

```typescript
import { startBeacon } from "@kensio/rainlytics/beacon";

const beacon = startBeacon();
```

The beacon sends GET requests to `/_rainlytics` on the site's own domain. A CloudFront Function
returns 204 and CloudFront records each request in the access log. Requests use `fetch` with
`credentials: "omit"` and `keepalive: true`. The beacon sends no cookies and creates no browser
identifier.

## Report events

`startBeacon` watches `history.pushState`, `history.replaceState` and browser navigation. It reports
a `route` event when the visible path changes.

CloudFront already logged the document request for the first page. The beacon begins with later
route changes, avoiding a duplicate view.

Report a custom event with `report`:

```typescript
beacon.report({
  event: "signup",
  page: location.pathname,
});

beacon.report({
  event: "purchase",
  page: location.pathname,
  value: 4995,
  subject: "SKU-1234",
});
```

A request can contain several events. Each event has an `event` name and a `page` path. Optional
fields are `value` for a number, `subject` for what it measures (such as a SKU), and `message` for
text. CloudFront stores one log record per request. Rainlytics queries unpack that record into
one row per event.

Keep personal data out of event names, pages, subjects and messages. These values remain in the raw
log until its lifecycle expires them.

## Report several events in one request

Pass several events to one `report` call to send them together:

```typescript
beacon.report(
  { event: "purchase", page, value: 4995, subject: "SKU-1234" },
  { event: "purchase-line", page, value: 1999, subject: "SKU-9876" },
);
```

Each call sends immediately. Separate calls make separate requests. If a batch would exceed the
request size limit, the beacon splits it across several requests.

## What the beacon costs

Under CloudFront pay-as-you-go pricing, beacon requests incur request and function invocation
charges. Their log records also contribute to S3 storage and Athena scans. See
[Beacon path](../beacon-path/#limits-and-cost).

Under a [CloudFront flat-rate plan](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html),
beacon requests count toward the monthly request allowance. Sending several events in one request
reduces that usage. Monitor request counts as well as data transfer.

## Send numbers as integer minor units

Rainlytics stores `value` without a unit or currency. For money, send an integer in the smallest
currency unit. For example, send `4995` for £49.95 or $49.95. This avoids floating-point rounding
errors when summing amounts.

Choose a unit for each event name before collecting data and keep it consistent. Mixing pounds
and pence, or different currencies, produces an invalid total. See [Rollups](../rollups/) for the
query that sums these values.

## Report an order with several items

Each event can hold one number, one subject and one message. To report an order and its individual
items, send separate event names for the order total and the item totals:

```typescript
beacon.report({
  event: "purchase",
  page: location.pathname,
  value: order.totalInPence,
  subject: order.reference,
});

for (const line of order.lines) {
  beacon.report({
    event: "purchase-line",
    page: location.pathname,
    value: line.totalInPence,
    subject: line.sku,
  });
}
```

Sum `purchase` events to measure revenue. Group `purchase-line` events by subject to measure sales
of each item. Summing both event names together would count the same money twice.

Keep the number of events per action small. An order with fifty lines is fifty events, and even
batched into one request it is fifty rows once a query unpacks it.

## Collect Core Web Vitals

Vitals use a separate entry point:

```typescript
import { reportVitals } from "@kensio/rainlytics/beacon/vitals";

reportVitals(beacon);
```

Rainlytics reports:

| Event  | Measurement              | Unit         |
| ------ | ------------------------ | ------------ |
| `ttfb` | Time to First Byte       | milliseconds |
| `fcp`  | First Contentful Paint   | milliseconds |
| `lcp`  | Largest Contentful Paint | milliseconds |
| `cls`  | Cumulative Layout Shift  | score        |

TTFB waits up to four seconds for FCP so they can share one request. LCP and CLS share a request
when the document first becomes hidden. CLS uses the worst session window and ignores shifts
after recent user input. See [Web Vitals](../web-vitals/) for timing and calculation details.

Rainlytics does not calculate Interaction to Next Paint (INP). You can collect it with the
`web-vitals` library and report the result:

```typescript
import { onINP } from "web-vitals";

onINP(({ value }) => {
  beacon.report({ event: "inp", page: location.pathname, value });
});
```

The shipped `web-vitals` rollup currently reports TTFB, FCP, LCP and CLS.

## Collect JavaScript errors

Error reporting also uses a separate entry point:

```typescript
import { reportErrors } from "@kensio/rainlytics/beacon/errors";

reportErrors(beacon);
```

Uncaught exceptions use event name `error`. Unhandled promise rejections use `rejection`. The
message is limited to 200 characters and no stack trace is sent.

Error messages can contain email addresses, account names and other personal data. Redact them
before they reach the immutable log:

```typescript
reportErrors(beacon, {
  redact: (message) => message.replace(/\S+@\S+/gu, "[email]"),
});
```

Return `undefined` from `redact` to drop a message. Query-time cleanup is too late to remove the raw
value.

## Consent and stopping

The site owns the consent decision. Start the beacon after the site's consent flow approves it:

```typescript
const beacon = consented ? startBeacon() : undefined;
```

Stop reporting when consent is withdrawn:

```typescript
beacon?.stop();
```

`stop` restores the original history methods. Later `report` calls send no requests.

## Options

```typescript
const beacon = startBeacon({
  path: "/_measure",
  reportRoutes: false,
});
```

`path` defaults to `/_rainlytics` and must match `BeaconPath`. Set `reportRoutes: false` when your
framework already provides a router hook and you only want explicit `report` calls.

## Page weight and browser support

The base beacon is currently 707 bytes gzipped. Vitals and errors together bring the complete set
to 1,559 bytes gzipped. Project checks bundle, minify and gzip each entry point and fail when a size
budget is exceeded.

The browser target is Baseline 2022 (Chrome and Edge 108, Firefox 108 and Safari 16). A browser
without fetch keepalive still attempts the request, but its final event is more likely to be lost
during navigation.

<!-- card
```typescript
const beacon = startBeacon();
beacon.report({ event: "signup", page: location.pathname });
```
-->
