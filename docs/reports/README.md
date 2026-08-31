# Calendar reports

A report is a versioned JSON document containing several questions over one closed calendar period.

`ReportDocument` describes the document. `reportPeriod`, `reportSection`, `reportDocument` and
`reportKey` build the parts shared by a scheduled writer and a reader.

```typescript
import {
  reportDocument,
  reportKey,
  reportPeriod,
  reportSection,
} from "@kensio/rainlytics";
```

Computing, storing, reading and rendering reports sit outside this schema.

## The document

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
  "computedAt": "2026-08-30T23:15:03.001Z",
  "sections": [
    {
      "question": {
        "name": "status-codes",
        "includeBots": false,
        "limit": 20,
        "param": "q",
        "redirectStatuses": ["302", "303", "307"]
      },
      "accuracy": "exact",
      "composition": "additive",
      "source": {
        "from": "2026-08-23T23:00:00.000Z",
        "until": "2026-08-30T23:00:00.000Z",
        "summaries": 168,
        "complete": true
      },
      "value": {
        "type": "rows",
        "columns": ["status", "responses"],
        "rows": [{ "status": "200", "responses": "18492" }]
      }
    },
    {
      "question": {
        "name": "web-vitals",
        "includeBots": false,
        "limit": 20,
        "param": "q",
        "redirectStatuses": ["302", "303", "307"]
      },
      "accuracy": "unavailable",
      "composition": "none",
      "reason": "percentiles-do-not-compose",
      "source": {
        "from": "2026-08-23T23:00:00.000Z",
        "until": "2026-08-30T23:00:00.000Z",
        "summaries": 168,
        "complete": true
      },
      "value": null
    }
  ]
}
```

`period` names the local calendar dates and their UTC instants. `sourceCoverage` is the outer span
represented by the section sources. Its `complete` field is true when at least one source covers the
whole report period without a gap. A document whose expected rollups are all missing carries
`null`.

`computedAt` is the instant the document was assembled. The builder refuses an instant before the
period closes.

Every section records its `SummaryQuestion`. A filter or limit that changes the stored answer stays
attached to the value in the report. The `source` names the span and number of stored summaries used.

## Calendar boundaries

`reportPeriod` accepts any instant inside a day, week, month or year. An IANA time zone supplies the
calendar. Days begin at local midnight. Months begin on their first local date and years begin on 1
January.

Weeks begin on Monday by default. Passing `weekStartsOn` selects any other weekday, and a weekly
period records the choice. The other units omit it because it has no effect on their boundaries.

The UTC duration follows the local calendar. A day across a daylight-saving change can contain 23 or
25 hours. A week containing that day changes length with it. `from` and `until` record the resulting
UTC instants, while `startsOn` and `endsBefore` record the local dates.

Reports cover closed periods. The second argument to `reportPeriod` is the computation clock. The
builder accepts the period when `until` is equal to or earlier than that clock. It raises a
`RangeError` while the current period is still open.

```typescript
const period = reportPeriod(
  {
    unit: "month",
    at: new Date("2026-07-15T12:00:00Z"),
    timeZone: "Europe/London",
  },
  new Date("2026-08-01T00:00:00Z"),
);
```

The clock defaults to the current instant where a caller leaves it out. A scheduled writer can pass
its invocation time to make the decision reproducible.

## Section accuracy

`reportSection` assigns accuracy from the composition rule and source summaries. A caller supplies
the rule and the value but never supplies an accuracy label.

| Rule            | One summary spanning the report | Several summaries covering the report |
| --------------- | ------------------------------- | ------------------------------------- |
| `additive`      | exact                           | exact                                 |
| `ranked`        | exact                           | approximate                           |
| `visitor-count` | exact                           | unavailable                           |
| `percentile`    | exact                           | unavailable                           |

Counts add across windows. Derived percentages remain exact when they are recomputed from their
added counts before reaching the report section.

Ranked rows are truncated inside each stored summary. A row below every window's limit is absent
from the composed input, even when its full-period count would put it near the top. The builder marks
the composed ranking `approximate` and records `ranked-summaries` as its composition.

Visitor identifiers use a new salt each day. Counts from several windows can count the same person
more than once. The builder withholds the value and records `visitor-counts-do-not-compose`.

A percentile needs the observations from the full period. Stored percentile values contain too
little information to recover it. The builder withholds the value and records
`percentiles-do-not-compose`.

A gap or a source span shorter than the calendar period makes any rule unavailable with
`incomplete-source`. The section keeps the source metadata and sets its value to `null`.

## Missing optional rollups

An optional rollup missing from the summary store remains a section in the array:

```json
{
  "question": { "name": "web-vitals", "includeBots": false },
  "accuracy": "unavailable",
  "composition": "none",
  "reason": "missing-rollup",
  "source": null,
  "value": null
}
```

The representation keeps a report containing no measurements distinct from one whose writer never
looked for the question.

## Where a report lives

`reportKey` derives the key from the schema version and period:

```text
reports/v1/UTC/day/2026-08-24.json
reports/v1/Europe%2FLondon/week/monday/2026-08-24.json
reports/v1/Asia%2FTokyo/month/2026-08-01.json
```

The escaped time zone occupies one path segment. A weekly key includes its first weekday. The local
opening date sorts periods in calendar order under the prefix.

The schema version appears in the key and document. A reader asks for the version it understands.
Changing a field's meaning or removing it requires a new version. An optional field can be added to
the current version.

<!-- card
```json
{
  "period": { "unit": "week", "timeZone": "Europe/London" },
  "computedAt": "2026-08-30T23:15:03.001Z",
  "sections": [
    { "question": { "name": "pageviews" }, "accuracy": "approximate" },
    { "question": { "name": "web-vitals" }, "accuracy": "unavailable" }
  ]
}
```
-->
