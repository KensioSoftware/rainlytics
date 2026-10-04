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

## Write the message

A site can write the subject and body itself. Name a file of the site's own as `message.entry`, and
Rainlytics builds the publisher Lambda from it with `NodejsFunction` (esbuild has to be installed in
the site's CDK app).

```typescript
const summaries = new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  reportNotifications: {
    emails: ["analytics@example.com"],
    periods: ["day"],
    message: {
      entry: "lib/analytics/report-message.ts",
      environment: { USERS_TABLE: users.tableName },
    },
  },
});

const publisher = summaries.reportNotifications?.lambda;
if (publisher !== undefined) {
  users.grantReadData(publisher);
}
```

The entry exports a handler built by `reportNotificationHandler` from
`@kensio/rainlytics/notifications`. Rainlytics still reads the manifest, loads each report and its
previous period, runs `reportComparison`, publishes to SNS and sends failures to the dead-letter
queue. The message function receives the manifest, the reports, and the `questions`,
`maxRowsPerQuestion` and `subjectPrefix` settings. It returns the subject and body, and it can await
reads of its own.

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  reportNotificationHandler,
  reportNotificationMessage,
} from "@kensio/rainlytics/notifications";

import { countSignUps } from "./sign-ups.js";

const dynamo = new DynamoDBClient({});

export const handler = reportNotificationHandler({
  message: async (input) => {
    const signUps = await countSignUps(dynamo, input.manifest.closingDay);
    const standard = reportNotificationMessage(input);

    return {
      subject: standard.subject,
      message: `Sign-ups: ${signUps}\n\n${standard.message}`,
    };
  },
});
```

Each report carries `entry`, `current`, `previous` and `comparison`. The last two are absent for the
first report of its kind. `comparison.sections[i]` compares `current.sections[i]`.

The pieces of the default message are exported beside the handler, so a site can keep some sections
as they are and write others itself. `reportNotificationReportLines` gives one period's whole block,
and `reportNotificationHeading` its heading line. `reportNotificationSectionHeading` and
`reportNotificationSectionLines` give one question's lines, with a row limit of the site's choosing.
`reportNotificationSubject` gives the default subject. `limitedReportNotificationMessage` joins lines
and stops short of the SNS size limit.

The publisher checks what the function returns before publishing it. A subject has to be 1 to 99
characters with no line breaks, and a body has to be non-empty and within 256 KB. A message that
breaks either rule fails the invocation with the manifest key named, and Lambda retries it before it
reaches the dead-letter queue. `environment` names starting `RAINLYTICS_` are refused at synthesis,
because the publisher reads its own settings from them.

Leaving `message` out deploys the publisher from Rainlytics' own package with the default message.

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

The topic, Lambda function and queue have no hourly charge. A site's own message adds whatever reads it makes. A send uses one small S3 manifest PUT,
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
