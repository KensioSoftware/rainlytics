# Report notifications

Use `reportNotifications` to email selected calendar reports through Amazon SNS after they are
written. Reports closing on the same local day share one digest. For example, a Sunday at the
end of a month can include daily, weekly and monthly results in one message.

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

SNS sends each configured address a confirmation email during deployment. Follow its link to
start receiving reports. Unconfirmed subscriptions receive no notifications and expire after
AWS's confirmation window.

SNS's `email` protocol sends the message as plain text with SNS-managed headers and layout. Use
it for internal notifications. For branded or public email, use a service such as SES. See the
[SNS email limits](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html).

## Choose reports and questions

`periods` accepts `day`, `week`, `month` and `year`. All four are included when the setting is left
out. Rainlytics starts the notification process only when one of the selected periods closes. A
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

The changes come from [`reportComparison`](../reports/#compare-adjacent-periods). Counts use a
relative percentage. Ratios use percentage points. Metrics with a preferred direction also say
`improvement` or `regression`. A missing previous report leaves the current values in place and
marks the comparison unavailable.

## Use an existing topic

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

If you provide `summariesBucket`, pass a CDK `Bucket` object when notifications are enabled.
Rainlytics needs its event-notification methods to trigger the publisher. An object implementing
only the `SummariesBucket` interface is insufficient.

## Completion and delivery

The calendar report Lambda writes all selected reports before starting notification delivery.
It then writes a completion manifest, a small JSON file listing the finished reports and their
previous periods. A failed report run writes no manifest:

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
manifest, loads each listed report and its previous period, calculates comparisons, and publishes
one SNS message. It needs no Athena query.

S3 event notifications and SNS standard topics provide at-least-once delivery. The conditional
manifest prevents a report job retry from creating another notification for the same day. S3
event retries and SNS delivery retries can still produce duplicate emails.

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
