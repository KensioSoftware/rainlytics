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
  event: "purchase-value",
  page: location.pathname,
  value: 49.95,
});
```

Each request contains an envelope version, event name and page. Events can also carry one number or
one text value. Keep personal data out of event names, pages and messages. These values remain in
the raw log until its lifecycle expires them.

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
