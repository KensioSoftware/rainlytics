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

Every event carries three parameters, and nothing else.

| Parameter | Holds                                                  |
| --------- | ------------------------------------------------------ |
| `v`       | The envelope version, so an old row still reads later. |
| `e`       | What happened, such as `route`.                        |
| `p`       | The page it happened on, as a path.                    |

A route change reports itself under the name `route`. Anything else is the site's own call:

```typescript
beacon.report({ event: "signup", page: location.pathname });
```

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

## What it costs a page

Measured on a bundle of the code below, minified and gzipped:

```typescript
const beacon = startBeacon();
beacon.report({ event: "signup", page: location.pathname });
```

| Measure         | Bytes |
| --------------- | ----- |
| Minified        | 925   |
| Gzipped         | 545   |
| Budget, gzipped | 640   |

`pnpm check` fails over that budget. Brotli, which CloudFront serves to anything that asks, comes in
under the gzip figure. A site importing less than the above pays less, since a bundler drops the
exports nothing names.

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

**No Core Web Vitals and no JavaScript errors.** Both need fields beyond the three-parameter
envelope. They are tracked as
[#112](https://github.com/KensioSoftware/rainlytics/issues/112).

**No `navigator.sendBeacon`.** It is POST-only, and the whole design rests on a GET whose query
string CloudFront writes into `cs-uri-query`.

<!-- card
```typescript
const beacon = startBeacon();
```
-->
