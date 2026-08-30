# Browser beacon

Reports what a server log cannot see. A single-page app changing route moves the address bar and
makes no request, so CloudFront records nothing and layer 1 counts nothing. The beacon fills that
gap by sending a GET to a path on the site's own domain, which CloudFront then writes into the
access log like any other request.

```typescript
import { startBeacon } from "@kensio/rainlytics/beacon";

const beacon = startBeacon();
```

That is the whole of the setup. There is no script tag, no second host and no extra connection. The
module is bundled into the site's own JavaScript, and it goes out in a download the page was already
making.

Deploy [the collection path](../beacon-path/) first. Without it the site's origin answers these
requests, which is the one thing the design exists to avoid.

## What it collects

Every event carries the same three parameters. Two more travel where the event has them.

| Parameter | Always | Holds                                                  |
| --------- | ------ | ------------------------------------------------------ |
| `v`       | yes    | The envelope version, so an old row still reads later. |
| `e`       | yes    | What happened, such as `route` or `lcp`.               |
| `p`       | yes    | The page it happened on, as a path.                    |
| `n`       | no     | A number the event measured, such as a vital's value.  |
| `m`       | no     | Text the event carries, such as what an error said.    |

A route change reports itself under the name `route`. Anything else is the site's own call:

```typescript
beacon.report({ event: "signup", page: location.pathname });
beacon.report({ event: "inp", page: location.pathname, value: 180 });
```

`n` and `m` are left out of the query string entirely where an event has neither, so a route change
is the length it always was.

The request carries no cookies. `credentials: "omit"` is on every send, which keeps the site's own
cookies out of a header that would be paid for on each event and could reach a log. The beacon
generates no identifier of any kind. [Counting visitors](../visitors/) covers what a visitor is
here, and it is computed from the access log rather than from anything the browser sends.

`event` and `page` are the site's own values, and the beacon sends whatever it is handed. Keep
personal data out of both. Whatever they hold is written into `cs_uri_query` in the access log and
kept for as long as the log objects are.

**The page the beacon starts on is not reported.** Loading it was a request, CloudFront recorded it,
and reporting it again would count one view twice in two questions that are meant to agree. What the
beacon adds is every route change after that one. A route change to the page already showing is left
alone as well, which is what keeps a router putting a filter in the query string from reading as a
second view.

[Beacon events](../beacon-events/) has the rollup that reads these rows back, including the cap that
bounds a flood of them.

## Core Web Vitals

Behind an import of its own, so a site reporting route changes does not pay for it:

```typescript
import { startBeacon } from "@kensio/rainlytics/beacon";
import { reportVitals } from "@kensio/rainlytics/beacon/vitals";

const beacon = startBeacon();
reportVitals(beacon);
```

Four measurements, each sent once, each carrying its number in `n`.

| Event  | Is                           | Read from                  | Sent                |
| ------ | ---------------------------- | -------------------------- | ------------------- |
| `ttfb` | Time To First Byte, ms       | the `navigation` entry     | straight away       |
| `fcp`  | First Contentful Paint, ms   | a `paint` entry            | when it happens     |
| `lcp`  | Largest Contentful Paint, ms | `largest-contentful-paint` | when the page hides |
| `cls`  | Cumulative Layout Shift      | `layout-shift` entries     | when the page hides |

TTFB and FCP are final as soon as they happen. LCP and CLS are not final until the page stops
painting and stops moving, so both are held until `visibilitychange` reports the document hidden and
sent then. That is the moment `keepalive` on the send exists for. Every ordinary way of leaving a
page hides the document first, including following a link and closing the tab, and a page that is
never hidden reports neither.

CLS is scored on the worst session window rather than the sum of every shift. A window runs no
longer than five seconds and ends after a second without a shift. A page that shifts a little every
few seconds all day would otherwise score as though it had shifted once, enormously. A shift the
reader caused is left out, which is the layout responding rather than the layout misbehaving.

Each observer asks for `buffered` entries, so a paint that happened before the site's bundle ran
still reports. Without that, every fast page would report nothing.

**INP is not collected, and that is deliberate.** It is a Core Web Vital, and computing it means
grouping event-timing entries by `interactionId` and taking a high percentile of the result. A
version of that with a subtle mistake in it reports a plausible number rather than an obvious
failure, which is the failure this project is least able to detect. A site that wants INP runs the
`web-vitals` library itself and hands the number over:

```typescript
import { onINP } from "web-vitals";

onINP(({ value }) => {
  beacon.report({ event: "inp", page: location.pathname, value });
});
```

That is also the measured trade. `web-vitals` covering LCP, CLS and INP bundles to 3209 bytes
gzipped. The four above cost 550.

## JavaScript errors

Behind an import of its own as well, and that is a privacy decision as much as a page weight one:

```typescript
import { reportErrors } from "@kensio/rainlytics/beacon/errors";

reportErrors(beacon);
```

An uncaught exception reports as `error` and an unhandled promise rejection as `rejection`, each
carrying what it said in `m`. The page is read when the error happens, so an error in a single-page
app is reported against the route it happened on. Neither listener handles the error. The browser
still logs to the console and any other handler on the page still runs.

**No stack.** A stack names the URL of every frame and often a good deal more, none of it fits in a
query string worth storing, and the name and message are what a rollup counting errors would group
by. The message is cut at 200 characters, because the whole query string is stored for as long as
the log objects are.

## What a site holding no personal data gets

[Counting visitors](../visitors/) has the field set that delivers no viewer address. A deployment
running it holds no personal data, and the beacon can hand some back. This is what each part does
about that.

- **Route changes and vitals cannot.** A path the site publishes and a number are not personal data,
  whoever is reading.
- **`event` and `page` are the site's own values.** The beacon sends what it is handed. A router
  that puts an account name in a path puts it in the log.
- **An error message is the risk.** It is the site's own text, written by the site's own code, and
  nobody audits it for what it interpolates. This is why errors are behind an import rather than a
  flag. Importing them is the decision.

`redact` is where a site takes it back out. It runs on the whole message, before the 200-character
cut and not after it, so a pattern written for a whole address still matches one that would have
been cut in half. Answering `undefined` reports nothing for that error:

```typescript
reportErrors(beacon, {
  redact: (message) => message.replace(/\S+@\S+/gu, "[email]"),
});
```

Nothing already written comes back out. The raw store is immutable and keeps whatever was written
into it until the [log bucket](../log-bucket/) expiry reaches it, so this is a decision to take
before turning error reporting on rather than after.

## What it costs a page

Each import is measured on a bundle of what a site actually writes, minified and gzipped.

| What a site imports | Minified | Gzipped | Budget |
| ------------------- | -------- | ------- | ------ |
| The beacon          | 1042     | 586     | 640    |
| With vitals         | 2290     | 1136    | 1250   |
| With errors         | 1489     | 756     | 880    |
| All of it           | 2853     | 1349    | 1500   |

`pnpm check` fails over any of those budgets. Brotli, which CloudFront serves to anything that asks,
comes in under the gzip figure.

Vitals and errors are separate imports so that these are separate numbers. A site reporting route
changes alone pays the first row and nothing else.

Bytes are not the only cost. The beacon adds no DNS lookup, no TLS handshake and no connection,
because the collection path is on the origin the page is already talking to. One event is a request
of a few hundred bytes that is answered at the edge with a 204 and no body.

## The browser floor

`browserslist` in package.json says `baseline 2022`, which is Chrome 108, Edge 108, Firefox 108 and
Safari 16. The build targets ES2021, and `tsconfig.json` has why that is a version behind.

The floor is set low on purpose. A beacon that fails on an older browser annoys nobody, and that is
the problem with it. The visitor still reads the site and still appears in the CloudFront rows layer
1 counts, so the two layers disagree by an amount invisible from inside the data. A low floor costs
nothing here, since none of this code needs syntax newer than ES2015.

Sending uses `fetch` with `keepalive`, which lets a request outlive the page that started it. Chrome
has had it since 66 and Safari since 13, and Firefox only since 133 (December 2024). A browser
without it ignores the option and sends the request anyway. What is lost there is the last event
before somebody navigates away, and a route change happens with the page still open.

## Switching it off

Consent belongs to the site. Nothing here reads a banner, a cookie or `navigator.doNotTrack`.

Call `startBeacon` once somebody has agreed:

```typescript
const beacon = consented ? startBeacon() : undefined;
```

And stop it if they take it back:

```typescript
beacon?.stop();
```

`stop` puts back the `History` methods that starting it wrapped, and `report` sends nothing
afterwards. Calling it twice is safe.

A consent story built into the beacon would be one more thing every page downloads, and it would be
wrong for whichever banner the site actually runs.

## Options

| Option         | Default        | What it changes                             |
| -------------- | -------------- | ------------------------------------------- |
| `path`         | `/_rainlytics` | The collection path, matching `BeaconPath`. |
| `reportRoutes` | `true`         | Whether route changes report themselves.    |

A site that passed `path` to the construct passes the same one here. If the two disagree, the beacon
reports to a path nothing answers, and the first sign of that is a dataset holding no beacon rows.

`reportRoutes: false` leaves `report` as the only way an event is sent, which suits a site that would
rather call its own router's hook.

## What it deliberately does not do

**No sampling.** A beacon event is a row in a log object the site is already paying for, and
`beacon-events` bounds a flood in the query. Sampling would cost bytes on every page to save nothing
worth saving, and it would put a scaling factor in front of numbers that are otherwise counts.

**No INP.** The section on vitals above has why, and what to do about it.

**No rollup over any of this yet.** The rows are here and no shipped question reads `n` or `m`.
`rainlytics query` answers one in the meantime, and the columns are `beaconValueColumn` and
`beaconMessageColumn`.

**No `navigator.sendBeacon`.** It is POST-only, and the whole design rests on a GET whose query
string CloudFront writes into `cs-uri-query`.

<!-- card
```typescript
const beacon = startBeacon();
```
-->
