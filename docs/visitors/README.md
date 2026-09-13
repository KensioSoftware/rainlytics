# Counting visitors

Rainlytics estimates visitors from the IP address and user agent in each CloudFront access-log
record. It counts each distinct pair once within a reporting period. A summary stores the count
in its `visitors` field:

```json
"visitors": { "distinct": 317, "additive": false }
```

## What the number means

The count approximates an audience, but it cannot identify individual people:

- two devices usually count twice
- identical browsers behind one household address can count once
- carrier-grade NAT can merge many people
- changing VPN or network can split one person
- records without a viewer address cannot count a visitor

The number is most useful when compared with the same site and configuration over time.

Automated traffic is omitted by default. The user-agent filter cannot identify every bot, and a
client can send any user agent it chooses.

## How the identifier is built

A salt is a value added to the address and user agent before hashing. Rainlytics derives a
different salt for each reporting period. Athena hashes these three values:

```sql
to_hex(sha256(to_utf8(concat(<period salt>, '|', c_ip, '|', cs_user_agent))))
```

The digest exists inside the query. Summaries store the final count only.

For daily summaries, the salt comes from an HMAC of one deployment secret and the UTC date:

```text
HMAC-SHA256(secret, "rainlytics/visitor-salt/1/" + date)
```

Hourly and daily summaries within the same UTC day use the same salt. Recomputing that day uses
the same salt again. Another date gets a different salt. Calendar reports derive a separate salt
for their full period.

The salt used by Athena appears as a literal in Athena query history. The deployment secret does
not. A period salt cannot derive the secret or another period's salt.

## Create the secret

Create one SSM Parameter Store `SecureString` in the account and region containing the summary
jobs:

```bash
aws ssm put-parameter \
  --name /rainlytics/visitor-salt \
  --type SecureString \
  --value "$(openssl rand -hex 32)"
```

CloudFormation cannot create a `SecureString`, and generating the value during synthesis would put
the secret in the template.

Keep this secret for the lifetime of the deployment. Replacing it breaks continuity and prevents
past periods from being recomputed with their original identity set. Pass another parameter name
with `visitorSaltParameter` on `RollupSummaries`.

## Combining visitor counts

Two hourly counts can contain the same browser. Two daily counts deliberately use different salts.
Adding either pair double-counts returning visitors.

The summary marks this rule with `additive: false`. Consumers must not add the stored visitor
counts. Use a calendar report for a visitor count across a week, month or year.

The `pageviews` command prints pageview rows. Read summary or report JSON to access visitor
counts. Adding `--query` to the command reruns the pageview query only.

## Choose a reporting period

Use a daily summary for a daily visitor count. Adding five daily counts would count a browser
that visited on all five days five times. The stored numbers cannot distinguish that browser
from five browsers that each visited once.

Use a calendar report for the whole period you want to measure. A weekly report queries the raw
logs with one salt for the week and counts each browser identity once across it.

Window boundaries also affect [conversion rates](../rollups/#measure-a-conversion-rate). A page
view at 09:59 and a purchase at 10:01 fall in separate hourly windows. A daily window includes both
unless the visit crosses midnight.

## Questions that count visitors

The default `pageviews` rollup counts visitors. A custom rollup opts in with
`countsVisitors: true`:

```typescript
import { pageviews, type Rollup } from "@kensio/rainlytics";

const articlePageviews: Rollup = {
  ...pageviews,
  name: "article-pageviews",
  countsVisitors: true,
};
```

The visitor count always covers pageview rows under the same host and path filters. A question that
counts another kind of event should normally omit it.

Counting visitors adds one Athena query per scheduled window. Under the default two granularities
and two-window recomputation, this is 50 queries a day.

## Run without visitor counts

Omit the viewer address from log delivery:

```typescript
import { logFieldNamesWithoutAddress } from "@kensio/rainlytics";

const delivery = new CloudFrontLogDelivery(this, "Delivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
  fields: logFieldNamesWithoutAddress,
});
```

`LogTable` then has no `c_ip` column. `RollupSummaries` computes the default questions without a
visitor count, needs no salt parameter and receives no `ssm:GetParameter` permission.

For an explicit question list, remove visitor counting from a rollup:

```typescript
import { pageviews, referrers, withoutVisitorCount } from "@kensio/rainlytics";

new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  rollups: [withoutVisitorCount(pageviews), referrers],
});
```

A question that requires visitor addresses is rejected during synthesis when the table has no
`c_ip` field.

## Raw addresses

The default raw logs contain viewer addresses for the bucket's retention period. S3 encryption
protects the stored objects, but an authorized reader can still read those addresses. Hashing
inside Athena does not remove them from the source logs.

Changing the field set affects new log objects only. Existing addresses remain until the log bucket
lifecycle expires them.

<!-- card
```json
"visitors": { "distinct": 317, "additive": false }
```
-->
