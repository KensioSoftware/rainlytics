# Rollup summaries

A rollup summary is one precomputed question over one closed time window. `RollupSummaries` writes
the JSON document to S3 and named CLI commands read it with `GetObject`.

## Document format

```json
{
  "schemaVersion": 1,
  "question": {
    "name": "pageviews",
    "includeBots": false,
    "limit": 100,
    "param": "q"
  },
  "window": {
    "granularity": "daily",
    "from": "2026-09-01T00:00:00.000Z",
    "until": "2026-09-02T00:00:00.000Z"
  },
  "computedAt": "2026-09-02T00:15:04.212Z",
  "columns": ["path", "views"],
  "rows": [
    { "path": "/", "views": "412" },
    { "path": "/articles/", "views": "208" }
  ],
  "visitors": { "distinct": 317, "additive": false }
}
```

Import the type from the package root:

```typescript
import type { RollupSummary } from "@kensio/rainlytics";
```

`question` records the rollup name, bot choice, row limit and any host, path or search settings. A
reader can verify that a stored answer matches the question it was asked.

`columns` stays present when `rows` is empty. Every row value is text or `null`, matching Athena
results. All timestamps are ISO 8601 strings.

`visitors` appears on questions that count visitors. It is absent from deployments that omit the
viewer address or questions that do not count pageviews.

## Object keys

Summaries use deterministic keys:

```text
summaries/v1/pageviews/daily/2026-09-01.json
summaries/v1/pageviews/hourly/2026-09-01T14Z.json
```

Build a key in TypeScript:

```typescript
import { summaryKey } from "@kensio/rainlytics";

const key = summaryKey(question, {
  granularity: "daily",
  at: new Date("2026-09-01T12:00:00Z"),
});
```

Any instant inside a window produces the same key. A later run replaces the object, allowing late
CloudFront logs or a corrected query to update the answer.

Only the question name appears in the key. Schedule distinct narrowings under distinct rollup names
so they cannot overwrite each other.

## Hourly and daily windows

Rainlytics stores hourly and daily UTC summaries by default. Each window is calculated directly
from raw logs.

Daily summaries reduce the number of S3 reads for long ranges. Hourly summaries cover short ranges,
fill gaps when a daily run failed and let reports assemble local calendar days.

Daily summaries are not built by adding hourly rows. Direct calculation avoids three errors:

- a ranked top list can lose rows that were below the limit in each hour
- visitor identities cannot be added across independently salted periods
- a late log may arrive after an hourly summary was written

## Empty and missing windows

An empty `rows` array means the query ran and found no matching traffic. A missing S3 object means
the window was never computed.

The package represents a missing object with `neverComputed`:

```typescript
import { neverComputed, type SummaryLookup } from "@kensio/rainlytics";

const result: SummaryLookup = await readSummary(key);

if (result === neverComputed) {
  // The scheduled job did not write this window.
}
```

This distinction lets a CLI command separate a quiet window from a failed or not-yet-deployed job.

## Schema versions

The schema version appears in both the key and the document. A breaking format change uses a new
prefix such as `summaries/v2/`. Readers ask for the version they understand.

Optional fields can be added without changing the version. This is how `visitors` was added.

## Read summaries

Set the bucket and run a named command:

```bash
export RAINLYTICS_SUMMARY_BUCKET=rainlytics-summaries-1a2b
rainlytics pageviews --last 7d
```

The command selects complete daily windows first and uses hourly windows around them. It reports the
actual covered span and any missing windows on standard error.

A missing window in the middle stops the read because silently skipping it would undercount the
result. A missing window at either edge is reported and omitted. A range with no stored windows also
stops. Use `--query` when you choose to calculate the answer from Athena.

Reading needs `s3:GetObject` on the summaries bucket. Grant it with:

```typescript
summaries.grantReadingSummaries(role);
```

## Visitor totals

```json
"visitors": { "distinct": 317, "additive": false }
```

`additive: false` prevents a reader from treating daily visitor counts as normal totals. The same
browser can appear in several windows, and daily salts prevent those identities from being linked by
adding summary values. Use a period-wide raw query or a calendar report for a longer visitor count.

See [Counting visitors](../visitors/).

<!-- card
```json
{
  "question": { "name": "pageviews", "includeBots": false },
  "window": { "granularity": "daily", "from": "2026-09-01T00:00:00.000Z" },
  "rows": [{ "path": "/", "views": "412" }]
}
```
-->
