# Calendar reports

`RollupSummaries` precomputes one JSON report for every closed day, week, month and year. EventBridge
Scheduler invokes a separate report Lambda once a day. The function composes stored summaries where
their arithmetic is safe, runs a period-wide Athena query where it is not, and writes the finished
document to the summaries bucket.

```typescript
new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  reportTimeZone: "Europe/London",
  reportWeekStartsOn: "monday",
});
```

The defaults use UTC and Monday. The report job runs 30 minutes after local midnight, after the
default summary run at 15 minutes past. It recomputes reports for the two most recently closed days.
A day that also closes a week, month or year causes that larger period to be written too.

The recomputation is intentional. CloudFront can deliver a late object after the first summary run.
The next run rebuilds that summary, and the report writer reads it again. The existing report is
never an input. A successful rerun replaces the object at the same deterministic key.

## The document

`ReportDocument` describes each stored document. `reportPeriod`, `reportSection`, `reportDocument`
and `reportKey` are also exported for code that reads or builds the schema.

```typescript
import {
  reportDocument,
  reportKey,
  reportPeriod,
  reportSection,
} from "@kensio/rainlytics";
```

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
      "question": {
        "name": "status-codes",
        "includeBots": false,
        "limit": 20,
        "param": "q",
        "redirectStatuses": ["302", "303", "307"]
      },
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
      "accuracy": "exact",
      "composition": "period-query",
      "source": {
        "from": "2026-08-23T23:00:00.000Z",
        "until": "2026-08-30T23:00:00.000Z",
        "summaries": 0,
        "queries": 1,
        "complete": true
      },
      "value": {
        "type": "rows",
        "columns": ["metric", "p75"],
        "rows": [{ "metric": "LCP", "p75": "2450" }]
      }
    }
  ]
}
```

`period` records the local calendar dates and their UTC instants. `sourceCoverage` is the outer span
represented by the section sources. Its `complete` field is true when at least one source covers the
whole report period without a gap. A document whose expected rollups are all missing carries
`null`.

`computedAt` is the instant the document was assembled. The builder refuses an instant before the
period closes.

Every section records its `SummaryQuestion`. A filter or limit that changes the stored answer stays
attached to the value in the report. The `source` records the span and the number of summaries or
period queries used.

## Calendar boundaries

`reportPeriod` accepts any instant inside a day, week, month or year. An IANA time zone supplies the
calendar. Days begin at local midnight. Months begin on their first local date and years begin on 1
January.

Weeks begin on Monday by default. Passing `weekStartsOn` selects another weekday, and a weekly
period records the choice. The other units omit it because it has no effect on their boundaries.

The UTC duration follows the local calendar. A day across a daylight-saving change can contain 23 or
25 hours. A week containing that day changes length with it. `from` and `until` record the resulting
UTC instants. `startsOn` and `endsBefore` record the local dates.

Reports cover closed periods. The second argument to `reportPeriod` is the computation clock. The
builder accepts the period when `until` is equal to or earlier than that clock. It raises a
`RangeError` while the current period is open.

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

The clock defaults to the current instant where a caller leaves it out. The scheduled writer passes
its invocation time so the decision is reproducible.

## How sections are calculated

The writer uses stored summaries when a rollup exposes serialisable addition rules. It chooses the
largest available UTC windows that exactly cover the report. A UTC report normally reads daily
summaries. A time zone offset from UTC uses hourly summaries at its edges and daily summaries in its
interior.

Additive counts remain exact. A percentage remains exact when the stored totals expose the counts
needed to recompute it. Ranked answers become approximate when they combine several summaries. Each
summary has already discarded rows below its limit, so a full-period ranking cannot recover every
candidate.

The writer runs one Athena query over the whole period where summaries cannot produce the right
answer. Percentiles use this path. So does a derived value whose recomputation is only available as
JavaScript, including the default cache hit ratio. The section records `period-query`, zero
summaries and one query. Its result is exact.

Visitor counts always use a period query. Daily summary salts deliberately prevent identities from
linking across days. The report query derives a separate salt for the whole calendar period, which
allows one person to count once without reusing an identifier from another period.

`reportSection` applies the following rules when code builds a section directly from summaries.

| Rule            | One summary spanning the report | Several summaries covering the report |
| --------------- | ------------------------------- | ------------------------------------- |
| `additive`      | exact                           | exact                                 |
| `ranked`        | exact                           | approximate                           |
| `visitor-count` | exact                           | unavailable                           |
| `percentile`    | exact                           | unavailable                           |

The scheduled writer avoids the last two unavailable results by using a period query.

## Incomplete sources

A missing, malformed or mismatched summary becomes a gap. The writer does not hide such a gap with
a raw query. The affected section has `accuracy` set to `unavailable`, `reason` set to
`incomplete-source`, and `value` set to `null`. Its source metadata covers only the summaries that
were actually read, so the document cannot present incomplete data as a complete answer.

An optional rollup that was expected but never stored can be represented as `missing-rollup` with a
null source. This keeps a report containing no measurements distinct from one whose writer never
looked for the question.

## S3 keys and retention

`reportKey` derives the key from the schema version and period.

```text
reports/v1/UTC/day/2026-08-24.json
reports/v1/Europe%2FLondon/week/monday/2026-08-24.json
reports/v1/Asia%2FTokyo/month/2026-08-01.json
```

The escaped time zone occupies one path segment. A weekly key includes its first weekday. The local
opening date sorts periods in calendar order under the prefix. A rerun sends another S3 `PutObject`
to this key, so readers see the recomputed document without finding a new location.

The schema version appears in the key and document. A reader asks for the version it understands.
Changing a field's meaning or removing it requires a new version. An optional field can be added to
the current version.

The default raw log retention is 370 days. That covers a 366-day annual report and leaves four days
for its scheduled recomputation. Shortening `LogBucket.retention` below the largest report period
can make that report unavailable. The report documents themselves remain in the summaries bucket.

## Reading a report

The command line selects a report from its calendar period and reads the document with one S3 GET.
It derives the key from the unit, date, time zone and first weekday.

```bash
rainlytics report day 2026-08-30 --summaries rainlytics-summaries-1a2b
rainlytics report week 2026-08-24 --time-zone Europe/London
rainlytics report month 2026-07
rainlytics report year 2025
```

`--time-zone` and `--week-starts-on` must match the `RollupSummaries` deployment. The defaults are
UTC and Monday. The bucket comes from `--summaries` or `RAINLYTICS_SUMMARY_BUCKET`, and the region
comes from `--region` or the AWS SDK's default chain.

The versioned document is written unchanged as JSON on standard output. The bucket, object key,
object age and one-GET cost go to standard error. A missing, incomplete or unsupported document
leaves standard output empty and exits non-zero. The reader never runs Athena.

## Comparing adjacent periods

`reportComparison` compares a closed report with the immediately preceding period of the same
calendar unit. It uses the time zone and first weekday recorded by the current report. Calendar
arithmetic selects the earlier period, including weeks with a configured first day and periods
around daylight-saving changes.

```typescript
import { previousReportPeriod, reportComparison } from "@kensio/rainlytics";

const previousPeriod = previousReportPeriod(current.period);
const comparison = reportComparison({ current, previous });
```

The comparison is a derived result with its own schema version. Stored report documents remain the
source. The report writer can overwrite either document when late logs arrive. A stored comparison
would then describe an older pair of values until another job refreshed it. Deriving the result
from both documents keeps recomputation in one place and needs no Athena query.

Pass `--compare` to ask the command line for the derived result:

```bash
rainlytics report month 2026-07 --compare
```

The command reads the selected report first. It then reads the preceding report with one additional
S3 GET. Standard output remains one JSON document. Standard error names both keys, their ages and
the cost of two GET requests.

The comparison carries document metadata for both reports. Each available section also carries the
two section sources, their calculation methods and a combined accuracy. The combined accuracy is
`approximate` when either source section is approximate.

Metric changes follow these rules:

| Metric                                   | Change              | Unit and direction                                                                        |
| ---------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Counts, including pageviews and visitors | Relative percentage | The metric's count unit. Movement is unrated.                                             |
| Cache hit ratio                          | Percentage points   | Percent. A higher value is better.                                                        |
| Web Vitals p75                           | Relative percentage | Milliseconds for LCP, FCP and TTFB. CLS uses its unitless score. A lower value is better. |
| Caller-defined durations                 | Relative percentage | Supplied by the metric definition. The definition also supplies the preferred direction.  |

A zero baseline produces a `null` relative change with `reason` set to `zero-baseline`. The current
value, previous value, numeric difference and trend remain available. JSON never contains infinity.

Rows are matched on every non-metric column. A row present on one side only has an unavailable
comparison. Ranked questions use `ranked-row-absent` as the reason because the row may sit below the
other period's stored limit. Its missing value stays `null` and never becomes zero.

Sections are withheld when a source is incomplete or unavailable, the question configuration
changed, the columns changed, or either report lacks the section. Rainlytics supplies definitions
for its shipped questions. A caller can pass `definitions` to `reportComparison` for a custom
question. A custom definition names the numeric columns, their units, the change measure and the
preferred direction.

## Cost

The report path has no reserved or hourly capacity. Its AWS services charge for invocations,
duration, requests, bytes stored and bytes scanned.

The default deployment creates one Scheduler invocation and one 512 MB Lambda invocation each day.
AWS includes 14 million Scheduler invocations per month and one million Lambda requests plus 400,000
GB-seconds per month in their free tiers. The report schedule is 30 invocations per month.

The six default rollups issue two period queries per report. One computes the cache hit ratio and one
counts pageview visitors. Recomputing two closing days writes about 72 reports and runs about 143
queries in an average month. At Athena's 10 MB minimum and $5 per TB, those queries cost about
$0.0072. Actual cost rises when a period query scans more than 10 MB.

For UTC reports, composing the other five questions reads about 1,217 summary objects and writes
about 72 report objects per month. At the US East (N. Virginia) S3 Standard request prices of $0.0004
per 1,000 GET requests and $0.005 per 1,000 PUT requests, those requests cost about $0.00085. The
small JSON documents add a fraction of a cent in storage. Other Regions can have different prices.

The report writer therefore adds about one cent per month for a quiet default deployment whose
Lambda usage stays inside the free tier and whose Athena queries stay at the minimum. This estimate
does not include the existing summary jobs. Traffic volume and added period-query rollups determine
the variable part.

Prices were checked on 31 August 2026 against the [Athena pricing page](https://aws.amazon.com/athena/pricing/),
[EventBridge pricing page](https://aws.amazon.com/eventbridge/pricing/), [Lambda pricing
page](https://aws.amazon.com/lambda/pricing/) and [S3 pricing page](https://aws.amazon.com/s3/pricing/).

<!-- card
```json
{
  "period": { "unit": "week", "timeZone": "Europe/London" },
  "computedAt": "2026-08-30T23:30:03.001Z",
  "sections": [
    { "question": { "name": "pageviews" }, "accuracy": "approximate" },
    { "question": { "name": "web-vitals" }, "accuracy": "exact" }
  ]
}
```
-->
