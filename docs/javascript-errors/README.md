# JavaScript errors

`javascript-errors` counts uncaught exceptions and unhandled promise rejections by page and
message, most reported first.

```typescript
import { javascriptErrors, rollups } from "@kensio/rainlytics";
import { RollupSummaries } from "@kensio/rainlytics/cdk";

new RollupSummaries(this, "RainlyticsSummaries", {
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
/checkout  Error: Order 41 failed                                 1
```

The count covers the `error` rows produced by uncaught exceptions and the `rejection` rows produced
by unhandled promise rejections. Route changes, Web Vitals and custom events are left out.

## A site opts into it

The six default rollups work from access-log fields every deployment has. This one reads rows from
optional browser error reporting. A site without those rows would pay for an empty Athena query on
every window, so `javascriptErrors` stays outside the exported `rollups` list.

Adding it on both cadences with the default two-window recomputation makes 50 more Athena queries a
day. At Athena's ten million byte minimum, that comes to about 8 cents a month. Lambda and S3 add a
few cents or less at this scale.

The command ships for every deployment. A missing summary is reported as a window that was never
computed. `--query` runs the same question from raw logs.

## Messages stay exact

The message is grouped exactly as `reportErrors` sent it, after the site's `redact` function and the
200-character limit. The group key contains the page and message only. An exception and a rejection
with the same values therefore share one row.

An interpolated value produces a group for each value. These messages are separate:

```text
Error: Order 41 failed
Error: Order 42 failed
```

Rainlytics keeps every part of the message. A number can be an order identifier, an HTTP status or a
line number that separates two failures. A general replacement would merge some errors that need
different fixes.

A site that wants one group can normalise the message before sending it:

```typescript
reportErrors(beacon, {
  redact: (message) => message.replace(/Order \d+/gu, "Order [number]"),
});
```

That replacement also changes the immutable raw row. Use `rainlytics query` or a custom rollup with
`regexp_replace` when the stored message must retain the value.

## The page comes from the event

The request itself goes to the collection path. Its `p` parameter records the page that was visible
when the error happened, including a route reached without a document request in a single-page app.
The rollup groups on that decoded value.

The collection path defaults to `/_rainlytics`, matching `BeaconPath`. A deployment using another
path records it on the summaries:

```typescript
new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  rollups: [...rollups, javascriptErrors],
  requests: { "javascript-errors": { paths: ["/_measure"] } },
});
```

The matching fresh query is:

```bash
rainlytics javascript-errors --path /_measure --last 7d --query
```

## Messages can contain personal data

An error message is text written by the measured site's own code. It can contain an email address,
an account name or another value about the person using the page. The rollup copies that message
into its summary and the command prints it.

Read the [browser beacon](../beacon/#what-a-site-holding-no-personal-data-gets) page before enabling
error reporting. Its `redact` option runs before the message reaches the access log. Query-time
normalisation leaves the value in the immutable raw row. Privacy filtering belongs in `redact`.

## Combining stored windows

Error counts add across stored windows. Rows match on both page and message. The command orders the
combined counts again and applies its requested limit.

Each summary stores only the leading rows from its own window. An error outside every stored top
list cannot appear in a combined answer, even when its total would be high enough. The command marks
that ranking as approximate. Use `--query` to rank all raw rows over the requested span.

<!-- card
```bash
rainlytics javascript-errors --last 24h
```
-->
