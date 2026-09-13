# JavaScript errors

The `javascript-errors` command counts browser errors by page and message. It includes uncaught
exceptions and unhandled promise rejections.

Add the optional rollup to your scheduled questions:

```typescript
import { javascriptErrors, rollups } from "@kensio/rainlytics";

new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: [...rollups, javascriptErrors],
});
```

```bash
rainlytics javascript-errors --last 24h
```

```text
page       message                                           errors
---------  ------------------------------------------------  ------
/checkout  TypeError: Cannot read properties of undefined        27
/account   Error: Session expired                                 9
```

## Enable collection

Import error reporting in the measured site:

```typescript
import { startBeacon } from "@kensio/rainlytics/beacon";
import { reportErrors } from "@kensio/rainlytics/beacon/errors";

const beacon = startBeacon();
reportErrors(beacon);
```

`error` events come from uncaught exceptions. `rejection` events come from unhandled promise
rejections. The browser's normal error behavior is unchanged.

The rollup is optional because a site without browser error events would pay for an empty query on
every scheduled window. Adding it under the default schedule adds 50 Athena queries a day.

## Grouping and redaction

Rows group by the exact page and message sent by the browser. Error and rejection events with the
same page and message share one row. If a message includes a different order ID on each request,
each ID produces a separate row.

Normalize a message before sending when several values should form one group:

```typescript
reportErrors(beacon, {
  redact: (message) => message.replace(/Order \d+/gu, "Order [number]"),
});
```

This also protects the raw log. A query-time replacement changes the report but leaves the original
message in S3.

Error messages can contain personal data. Review every message your application can produce and use
`redact` before enabling collection. Messages are limited to 200 characters and stack traces are
never sent.

## Custom collection paths

The rollup reads the default `/_rainlytics` path. Record another path in its summary request:

```typescript
new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: [...rollups, javascriptErrors],
  requests: {
    "javascript-errors": { paths: ["/_measure"] },
  },
});
```

Use the same path with `BeaconPath` and `startBeacon`.

## Combined windows

The command adds counts for matching page and message pairs across stored windows. Each summary
stores only its highest-ranked rows, so the combined ranking may omit errors that were below the
limit in individual windows. Add `--query` to rank all raw events across the full range.

<!-- card
```bash
rainlytics javascript-errors --last 24h
```
-->
