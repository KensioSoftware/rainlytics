# Counting visitors

Rainlytics defines a visitor as one browser identity inside one reporting period. It derives the
identity from the viewer address and user agent in the CloudFront access log.

```json
"visitors": { "distinct": 317, "additive": false }
```

## What the number means

The count describes browser connections, not known people:

- two devices usually count twice
- identical browsers behind one household address can count once
- carrier-grade NAT can merge many people
- changing VPN or network can split one person
- records without a viewer address cannot count a visitor

The number is most useful when compared with the same site and configuration over time.

Automated traffic is omitted by default. The user-agent filter cannot identify every bot, and a
client can send any user agent it chooses.

## How the identifier is built

Athena hashes the period salt, viewer address and user agent:

```sql
to_hex(sha256(to_utf8(concat(<period salt>, '|', c_ip, '|', cs_user_agent))))
```

The digest exists inside the query. Summaries store the final count only.

For daily summaries, the salt comes from an HMAC of one deployment secret and the UTC date:

```text
HMAC-SHA256(secret, "rainlytics/visitor-salt/1/" + date)
```

The same date produces the same salt during recomputation. Another date produces a different salt.
Calendar reports derive a separate salt for their full period.

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

The summary marks this rule with `additive: false`. The CLI refuses to add visitor values across
stored windows. Use a calendar report or `--query` for one identity set over a larger period.

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

The default log bucket stores viewer addresses in clear text for its retention period. The salt
protects derived identifiers, not the source rows. Anyone who can read the log bucket can read the
addresses.

Changing the field set affects new log objects only. Existing addresses remain until the log bucket
lifecycle expires them.

<!-- card
```json
"visitors": { "distinct": 317, "additive": false }
```
-->
