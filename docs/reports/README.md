# Calendar reports

`RollupSummaries` writes JSON reports for closed days, weeks, months and years. Each report contains
several analytics sections for one calendar period.

```typescript
new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  reportTimeZone: "Europe/London",
  reportWeekStartsOn: "monday",
});
```

The defaults use UTC and Monday. A daily schedule runs 30 minutes after local midnight and
recomputes the two most recently closed days. It also writes a week, month or year when that period
has just closed.

## Read a report

```bash
rainlytics report day 2026-08-30
rainlytics report week 2026-08-24 --time-zone Europe/London
rainlytics report month 2026-07
rainlytics report year 2025
```

The date selects a period. A weekly date can be any date inside the week. `--time-zone` and
`--week-starts-on` must match the deployment because both values are part of the S3 key.

The command writes the complete JSON report to standard output. Bucket, key, age and S3 request cost
go to standard error. A report read never starts Athena.

## Document format

```json
{
  "schemaVersion": 1,
  "period": {
    "unit": "week",
    "timeZone": "Europe/London",
    "weekStartsOn": "monday",
    "startsOn": "2026-08-24",
    "endsBefore": "2026-08-31",
    "from": "2026-08-23T23:00:00.000Z",
    "until": "2026-08-30T23:00:00.000Z"
  },
  "sourceCoverage": {
    "from": "2026-08-23T23:00:00.000Z",
    "until": "2026-08-30T23:00:00.000Z",
    "complete": true
  },
  "computedAt": "2026-08-30T23:30:03.001Z",
  "sections": [
    {
      "question": { "name": "pageviews", "includeBots": false },
      "accuracy": "approximate",
      "composition": "ranked-summaries",
      "source": {
        "from": "2026-08-23T23:00:00.000Z",
        "until": "2026-08-30T23:00:00.000Z",
        "summaries": 30,
        "complete": true
      },
      "value": {
        "type": "rows",
        "columns": ["path", "views"],
        "rows": [{ "path": "/", "views": "18492" }]
      }
    }
  ]
}
```

`period` carries local dates and the exact UTC range. A daylight-saving change can make a local day
23 or 25 hours long.

Each section records the question, calculation method, source coverage, accuracy and value. A
missing or malformed source produces an unavailable section rather than a partial value presented
as complete.

Import the builders and types from the package root:

```typescript
import {
  reportDocument,
  reportKey,
  reportPeriod,
  reportSection,
  type ReportDocument,
} from "@kensio/rainlytics";
```

## How sections are calculated

The report job combines stored summaries when their values can be combined correctly. Additive
counts remain exact. Rankings built from several truncated summaries are marked approximate.

The job runs a period-wide Athena query when summary values cannot reproduce the answer. This path
is used for percentiles, period visitor counts and derived values whose required raw totals are not
stored. Those sections are marked `period-query`.

Visitor counts use one salt derived for the complete report period. This lets a browser count once
without linking its identifier to another calendar period.

The report writer does not use an Athena query to hide missing summary windows. A gap makes the
affected section unavailable with `incomplete-source`.

## Object keys

```text
reports/v1/UTC/day/2026-08-24.json
reports/v1/Europe%2FLondon/week/monday/2026-08-24.json
reports/v1/Asia%2FTokyo/month/2026-08-01.json
```

A rerun writes the same key. Readers then see corrections for late logs without discovering a new
object. The schema version appears in the key and the document.

Raw log retention must cover the longest report period you need to recompute. The default 370 days
covers an annual report and its next scheduled rebuild.

## Compare adjacent periods

```bash
rainlytics report month 2026-07 --compare
```

The command reads the selected report and the immediately preceding report. It calculates a
versioned comparison document without Athena.

Counts use relative percentage change. Cache hit ratio uses percentage points. Web Vital values use
relative percentage change and treat lower values as better. A zero baseline produces a `null`
relative change with a `zero-baseline` reason rather than infinity.

Ranked rows are matched by their non-metric columns. A row present on one side only is unavailable
because it may have fallen below the other report's stored limit.

[`RollupSummaries` report notifications](../report-notifications/) use the same comparison result in
their plain-text SNS digest. The email publisher reads both stored reports and never runs Athena.

## Cost

The report path uses Scheduler, Lambda, Athena and S3 on demand. It reserves no capacity.

Most report sections reuse stored summaries. Period-wide Athena queries determine the variable
part of the cost. A quiet default deployment whose queries stay at Athena's minimum adds roughly a
cent a month for reports, excluding the summary jobs themselves. Traffic, optional questions and
regional prices change that estimate.

<!-- card
```bash
rainlytics report month 2026-07 --compare
```
-->
