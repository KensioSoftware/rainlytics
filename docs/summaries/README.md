# Rollup summaries

A rollup summary is the stored result of one analytics query over a completed hour or day.
`RollupSummaries` writes it as JSON in S3. Named CLI commands read the object with `GetObject`.

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

`question` records the rollup name, whether bots were included, the row limit and any host, path
or search filters. Readers use these fields to check whether the summary matches their request.

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

Only the question name appears in the key. Give differently filtered versions of a question
distinct rollup names to prevent them from overwriting each other.

## Hourly and daily windows

Rainlytics stores hourly and daily UTC summaries by default. Each window is calculated directly
from raw logs.

Daily summaries reduce the number of S3 reads for long ranges. Hourly summaries cover short ranges,
fill gaps when a daily run failed and let reports assemble local calendar days.

Daily summaries query the raw logs again. Combining hourly results could lose information:

- a ranked top list can lose rows that were below the limit in each hour
- visitor identities cannot be added across independently salted periods
- a late log may arrive after an hourly summary was written

## Empty and missing windows

An empty `rows` array means the query completed and found no matching traffic. A missing S3 object
means there is no stored result for that window. The job may not have run, may have failed, or the
object may have been removed.

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

Optional fields, such as `visitors`, can be added without changing the version.

## Read summaries

Set the bucket and run a named command:

```bash
export RAINLYTICS_SUMMARY_BUCKET=rainlytics-summaries-1a2b
rainlytics pageviews --last 7d
```

The command selects complete daily windows first and uses hourly windows around them. It reports the
actual covered span and any missing windows on standard error.

A missing window in the middle stops the read to avoid reporting an incomplete total. Missing
windows at either edge are reported and omitted. A range with no stored windows also stops.
Use `--query` to calculate the rollup rows from the available raw logs in Athena.

Reading needs `s3:GetObject` on the summaries bucket. Grant it with:

```typescript
summaries.grantReadingSummaries(role);
```

## Visitor totals

```json
"visitors": { "distinct": 317, "additive": false }
```

`additive: false` marks a count that cannot be added across windows. A returning browser can
appear in several windows, and the stored counts contain no identities to deduplicate. Use a
calendar report for a visitor count over a longer period.

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
