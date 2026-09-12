# Browser beacon

The browser beacon records events that CloudFront page requests miss, including SPA route
changes and events raised by the site.

```typescript
import { startBeacon } from "@kensio/rainlytics/beacon";

const beacon = startBeacon();
```

Import it into your site's existing JavaScript bundle. Deploy [Beacon path](../beacon-path/) first
so `/_rainlytics` returns 204 at the CloudFront edge.

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

A request carries one envelope version and every event it reports, and CloudFront writes it as one
log record. Each event inside it carries an event name and a page, and can also carry a number, a
subject naming what the number is about, and a text message. A query unpacks that record back into
one row per event, so a request is what the plan meters and an event is what a question counts.

Keep personal data out of event names, pages, subjects and messages. These values remain in the raw
log until its lifecycle expires them.

## Report several events in one request

`report` takes as many events as the site has to hand, and sends them in one request:

```typescript
beacon.report(
  { event: "purchase", page, value: 4995, subject: "SKU-1234" },
  { event: "purchase-line", page, value: 1999, subject: "SKU-9876" },
);
```

Nothing is held back for a later request. Events passed in one call travel together, and a call made
a second later is a second request. That keeps the beacon free of a timer, and of the events a timer
would still be holding when the page goes away.

## What the beacon costs

Under CloudFront pay-as-you-go pricing, an event is a row in a log object the site is already paying
for, and requests cost a fraction of a cent per ten thousand.

Under a CloudFront flat-rate plan the allowance meters requests, and a beacon event is one of them.
On one measured site the beacon accounted for 19.3% of all requests in an hour, against an allowance
the site was using 80% of in 11 days. Data transfer was nowhere near its own allowance. If a site is
on a flat-rate plan, requests are the dimension to watch, and reporting several events per call is
what reduces them.

## Send numbers as integer minor units

`value` is a number and Rainlytics never asks what it means. Send money as an integer count of the
smallest unit: 4995 for £49.95, and 4995 again for $49.95.

Two reasons. A total is a sum over thousands of rows, and floats drift over a sum where integers do
not. And the alternative is a unit on every row, which would be bytes paid on every Web Vital as
well, for something a site already knows about its own events.

The unit is a site's own convention and nothing checks it. A deployment that sent pounds for a
month and pence after it has a total that means neither, so pick one before the first event goes
out. `docs/rollups/` has the question that adds these up.

## Report something with more parts than the envelope holds

The envelope carries one number, one subject and one message. An order with three lines has more
parts than that, and there is no JSON payload to reach for.

Send one event per part, under an event name of its own:

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

Two event names, because a question totalling both would count the money twice. Each name is a
question of its own: `purchase` answers what the shop took, and `purchase-line` answers what sold.

Keep the number of events per action small. An order with fifty lines is fifty events, and even
batched into one request it is fifty rows once a query unpacks it.

The browser sends no cookies. Requests use `fetch` with `credentials: "omit"` and `keepalive: true`.
The beacon creates no browser identifier.

## Collect Core Web Vitals

Vitals use a separate entry point:

```typescript
import { reportVitals } from "@kensio/rainlytics/beacon/vitals";

reportVitals(beacon);
```

Rainlytics reports:

| Event  | Measurement              | Unit         | Sent                    |
| ------ | ------------------------ | ------------ | ----------------------- |
| `ttfb` | Time to First Byte       | milliseconds | when available          |
| `fcp`  | First Contentful Paint   | milliseconds | when available          |
| `lcp`  | Largest Contentful Paint | milliseconds | when the document hides |
| `cls`  | Cumulative Layout Shift  | score        | when the document hides |

CLS uses the worst session window and ignores shifts after recent user input. LCP and CLS wait until
the document hides because they can change while the page remains visible.

INP calculation needs interaction grouping and percentile logic. Rainlytics leaves that calculation
to `web-vitals`, and a site can report the result:

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

`stop` restores the wrapped history methods and makes later `report` calls inert.

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

The base beacon is currently 586 bytes gzipped. Vitals and errors together bring the complete set
to 1,349 bytes gzipped. Project checks bundle, minify and gzip each entry point and fail when a size
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
