# Report notifications

`RollupSummaries` can publish a plain-text SNS message after selected calendar reports have been
written. One local day produces one digest. A day that also closes a week, month or year can put all
of those reports in the same message.

```typescript
const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  reportTimeZone: "Europe/London",
  reportNotifications: {
    emails: ["analytics@example.com"],
    periods: ["day", "week", "month"],
    questions: ["pageviews", "cache-hit-ratio", "web-vitals"],
    maxRowsPerQuestion: 5,
    subjectPrefix: "Example analytics",
  },
});
```

SNS sends a confirmation email to each configured address during deployment. The address receives
reports after somebody follows that email's confirmation link. Unconfirmed subscriptions receive
no notifications and AWS removes them after its confirmation window.

The subscription uses SNS's `email` protocol. The published message becomes the plain-text email
body. SNS supplies fixed email headers and plain-text layout for this delivery type. Its email
feature is intended for internal notifications. A branded or public mailing needs an email service
such as SES. The [SNS email documentation](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html)
sets out those limits.

## Choosing reports and questions

`periods` accepts `day`, `week`, `month` and `year`. All four are included when the setting is left
out. Rainlytics writes a completion manifest only when one of the selected periods closes. A
monthly-only configuration therefore starts the publisher once a month.

`questions` accepts names computed by the same `RollupSummaries` deployment. Leaving it out includes
every question in each report. A name that the deployment does not compute fails CDK synthesis.

`maxRowsPerQuestion` limits ranked data in the message and defaults to five. It does not change the
stored report. The email names the S3 report object for a reader that needs the full document.

The subject has this form:

```text
Example analytics reports through 2026-08-31
```

The date is the closed local day. The body identifies the report time zone and then groups values by
calendar period and question.

```text
Example analytics reports through 2026-08-31
Time zone: Europe/London
Generated: 2026-08-31T23:30:02.104Z

Day 2026-08-31
Source: s3://example-summaries/reports/v1/Europe%2FLondon/day/2026-08-31.json

pageviews
  path=/: views 120 pageviews (+20%)

cache-hit-ratio
  hits 960 requests (+12.9%), misses 40 requests (-20%), hit_percent 96 percent (+2.1 percentage points, improvement)
```

The changes come from [`reportComparison`](../reports/#comparing-adjacent-periods). Counts use a
relative percentage. Ratios use percentage points. Metrics with a preferred direction also say
`improvement` or `regression`. A missing previous report leaves the current values in place and
marks the comparison unavailable.

## Using an existing topic

Pass a standard SNS topic to use subscriptions managed elsewhere:

```typescript
const topic = new sns.Topic(this, "AnalyticsNotifications", {
  enforceSSL: true,
});

const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  reportNotifications: { topic, periods: ["week", "month"] },
});
```

`summaries.reportNotifications` exposes the selected `topic`, the publisher `lambda` and its
`deadLetterQueue` for subscriptions, metrics and alarms.

A deployment that passes `summariesBucket` must pass a CDK `Bucket` object when notifications are
enabled. Rainlytics installs an Object-created event notification on that bucket. The smaller
`SummariesBucket` structural interface alone has no method for installing one.

## Completion and delivery

The calendar report Lambda writes all selected reports first. A failed report run writes no
completion manifest. A successful run writes this versioned document:

```json
{
  "kind": "calendar-report-notification",
  "schemaVersion": 1,
  "createdAt": "2026-08-31T23:30:02.104Z",
  "closingDay": {
    "unit": "day",
    "timeZone": "Europe/London",
    "startsOn": "2026-08-31",
    "endsBefore": "2026-09-01",
    "from": "2026-08-30T23:00:00.000Z",
    "until": "2026-08-31T23:00:00.000Z"
  },
  "reports": [
    {
      "period": {
        "unit": "day",
        "timeZone": "Europe/London",
        "startsOn": "2026-08-31",
        "endsBefore": "2026-09-01",
        "from": "2026-08-30T23:00:00.000Z",
        "until": "2026-08-31T23:00:00.000Z"
      },
      "key": "reports/v1/Europe%2FLondon/day/2026-08-31.json",
      "previousKey": "reports/v1/Europe%2FLondon/day/2026-08-30.json"
    }
  ]
}
```

The key is `report-notifications/v1/<time-zone>/<closed-day>.json`. The writer uses a conditional S3
PUT and keeps the existing object when the same report day runs again. Recomputing a report on the
following day can replace its report object, but it cannot create another manifest for the earlier
day.

An S3 `ObjectCreated:Put` event on this prefix invokes the publisher Lambda. The function reads the
manifest and both report objects, derives comparisons in memory, and calls SNS once. It never runs
Athena.

S3 event notifications and SNS standard topics provide at-least-once delivery. The conditional
manifest prevents a report Lambda retry from starting another intended send. An S3 event retry or an
SNS delivery retry can still produce a duplicate email. Exactly-once email would need a durable
idempotency store and a decision between a possible duplicate and a possible missed message.

Lambda retries a failed asynchronous invocation and then writes it to
`reportNotifications.deadLetterQueue`. The queue retains failed events for 14 days. A site can
alarm on its visible-message count if it wants active failure notification.

## Cost

The topic, Lambda function and queue have no hourly charge. A send uses one small S3 manifest PUT,
S3 GETs for the manifest and report documents, one Lambda invocation, one SNS publish and one SNS
delivery per subscriber. The dead-letter queue has traffic only after a failed invocation. Amazon
SNS prices standard topics by API request and endpoint delivery, with no minimum commitment. See the
[SNS pricing page](https://aws.amazon.com/sns/pricing/) for the current Region-independent email
delivery rate and free tier.

<!-- card
```typescript
reportNotifications: {
  emails: ["analytics@example.com"],
  periods: ["day", "week", "month"],
}
```
-->
