# Counting visitors

A visitor is one browser on one day. Rainlytics counts them from the viewer address CloudFront
records, hashed under a salt that changes every day.

```json
"visitors": { "distinct": 317, "additive": false }
```

That field rides on a [rollup summary](../summaries/) alongside the rows, on the questions that
count pages. `additive: false` is there because two days of visitor counts do not add up, and the
rest of this page is why.

## What the number is

The count is over the pageviews the summary's question covers. A summary narrowed to `/blog/`
reports the visitors to `/blog/`, and one narrowed to a host reports that host's. Views and visitors
are two numbers over one set of rows.

Automated traffic is left out, the way it is everywhere else. Bots are most of a quiet site's
traffic and each crawler would otherwise arrive as a visitor a day.

## What it stands for

One browser on one day, in one place.

- **Two devices are two visitors.** A phone on the train and a laptop at a desk carry two addresses.
- **A household is one visitor**, where two people behind one router run the same browser. The user
  agent goes into the hash for this reason and separates a phone from a laptop on the same address,
  and it cannot separate two identical iPhones.
- **A mobile carrier is fewer visitors than it should be.** Carrier-grade NAT puts thousands of
  people behind one address, and the user agent is what splits them, imperfectly.
- **A VPN moves somebody**, and the same person on and off one is two visitors.
- **A record with no address is nobody.** CloudFront started recording addresses for Rainlytics in
  [#73](https://github.com/KensioSoftware/rainlytics/issues/73). Every day before that delivery
  change counts zero visitors.

So it is a measure of browsers rather than of people, and the number moves with how a site's
readers connect. Every privacy-preserving analytics product reports the same measure, and each of
them counts a slightly different set of browsers. Compare the number against itself over time.

## What cannot be added up

The salt changes at midnight UTC. The same browser carries one identifier today and a different one
tomorrow.

A day of them counts. Two days added together count everybody who came back twice over, and a month
of them is a figure about nothing. Thirty summaries each carrying `"distinct": 429` are thirty
numbers `jq` will happily sum, and the total describes nobody.

That is what `additive: false` says in the document, and what the `VisitorCount` wrapper says to
TypeScript. A month of visitors is a query over raw, under the salt that month was counted with.

Hours work differently. Every hour of a day shares that day's salt, and the hourly summaries of a
day count the same identifiers the daily summary counts. They still fail to add, because somebody
who came back after lunch appears in two of them. The daily summary is the answer for a day.

## The identifier

```sql
to_hex(sha256(to_utf8(concat(<the day's salt>, '|', c_ip, '|', cs_user_agent))))
```

Athena computes it while counting, and every digest dies with the query that made it. The summary
holds the count and no more.

The three parts are joined by `|`, which an address cannot contain. The text hashed for one address
and user agent therefore belongs to that pair alone.

SHA-256 rather than the faster `xxhash64`. Both are in Athena engine version 3, and a 64-bit
non-cryptographic digest is forgeable by anybody holding one. At the volumes a site of this size
produces, the speed makes no difference worth having.

## Where the salt lives

The salt for a day is derived from one secret and the date:

```text
salt(day) = HMAC-SHA256(secret, "rainlytics/visitor-salt/1/" + day)
```

The secret is a `SecureString` in SSM Parameter Store. The Lambda that computes the summaries reads
it once per run and derives the salt for each window it is computing. Four things follow, and they
are the four the decision in
[#53](https://github.com/KensioSoftware/rainlytics/issues/53#issuecomment-3576795104) asked for.

**Every record of a day counts under one salt.** The day comes from the window, and every window
inside a day gives the same date.

**Tomorrow is a different salt.** The date is in the message the HMAC is taken over.

**A re-run of a day reproduces it.** The date comes from the window being computed and never from
the clock. A window recomputed next week therefore writes the count that was there before it. The
[summary schedule](../summary-schedule/) recomputes a trailing window on every run for exactly this,
and a salt taken from the clock would make the second run disagree with the first.

**A reader of the log bucket cannot get it.** The secret lives in Parameter Store alone, away from
the bucket, the summaries, the CloudFormation template and the schedule that carries the query. It
is encrypted at rest under the `aws/ssm` managed key, and reading it takes `ssm:GetParameter` on
that one parameter.

The secret is meant to stand rather than rotate. Replacing it makes every day from then on count
somebody new, and makes every day before it uncountable. The date is what rotates.

### The salt reaches Athena as text

Athena takes no secret of its own. The salt goes into the statement as a quoted literal, and a copy
of it then lives wherever Athena keeps its
[query history](https://docs.aws.amazon.com/athena/latest/ug/querying-keeping-query-history.html)
(45 days, behind `athena:GetQueryExecution` on the workgroup). CloudTrail
[records the query string as `***OMITTED***`](https://docs.aws.amazon.com/athena/latest/ug/monitor-with-cloudtrail.html)
for `StartQueryExecution`, and the statement reaches S3 nowhere.

This is why the statement carries a day's salt and never the secret. HMAC is built so that a key
cannot be recovered from a message and its digest. A salt read out of query history therefore covers
the days it appears for, and says nothing about any other day or about the secret.

## Creating the secret

Nothing creates it for you. CloudFormation writes `String` and `StringList` parameters and no
`SecureString`, and a construct that generated a secret at synthesis would put it in a template,
which is the one place it must not be.

```bash
aws ssm put-parameter --name /rainlytics/visitor-salt --type SecureString --value "$(openssl rand -hex 32)"
```

Run it once per deployment, in the account and region the summaries run in. The
[summary schedule](../summary-schedule/) construct takes `visitorSaltParameter` for a name of your
own, and grants the job `ssm:GetParameter` on whichever one it was given.

A run that meets no parameter fails and says so, naming the parameter and printing that command.
[Which questions carry a count](#which-questions-carry-a-count) says which runs read it.

## Which questions carry a count

`pageviews` alone, and it is one of the six questions a deployment gets when it passes no `rollups`
of its own. A default deployment therefore reads the salt parameter, and the secret has to be there
before its first run. [Running without a visitor count](#running-without-a-visitor-count) has the
deployment that reads no parameter at all.

A rollup says it counts with `countsVisitors`:

```typescript
import { pageviews, type Rollup } from "@kensio/rainlytics";

const blogVisitors: Rollup = {
  ...pageviews,
  name: "blog-pageviews",
  countsVisitors: true,
};
```

The count is always over pages, whatever the question beside it counts. A summary of status codes
carrying one would report a number about rows it never looked at, and the field is left out of every
question that counts something else. Absent and `{ "distinct": 0 }` mean different things, and a
reader can tell them apart.

It costs one extra Athena query per window per run. The six default rollup queries on both cadences,
recomputing two windows, make a subtotal of 300 queries a day and about 45 cents a month. The visitor
count on `pageviews` adds 50 queries and about 8 cents, making the default total 350 queries and
about 53 cents. The [summary schedule](../summary-schedule/#what-it-costs) page has the arithmetic.

## Running without a visitor count

A site that delivers no viewer address counts no visitors, and nothing else about it changes.

```typescript
import { logFieldNamesWithoutAddress } from "@kensio/rainlytics";

new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
  distributionId: "E1EXAMPLE1234",
  logBucket: logs.bucket,
  fields: logFieldNamesWithoutAddress,
});
```

That is the only line a site changes. The [log table](../log-table/) describes what the delivery
writes and the [summary schedule](../summary-schedule/) reads the table. Both follow. The schedule
computes the same six questions with the count off, needs no salt parameter, and is granted no
`ssm:GetParameter`. Summaries carry no `visitors` field, which a reader tells apart from a count of
zero.

A deployment naming its own questions says so per question:

```typescript
import { pageviews, referrers, withoutVisitorCount } from "@kensio/rainlytics";

new RollupSummaries(this, "RainlyticsSummaries", {
  table,
  workgroup,
  rollups: [withoutVisitorCount(pageviews), referrers],
});
```

A question that counts visitors over a table with no address is refused at synthesis, naming the
question. Left alone it would run once an hour against a column the table has never heard of.

The choice sits on the delivery because the delivery is what writes the raw store. Turning the
address off later leaves every address already written where it is, until the [log
bucket](../log-bucket/) expiry reaches it.

## Where the addresses are

The raw log bucket holds viewer addresses in the clear, for as long as it holds anything. That is
the price [#53](https://github.com/KensioSoftware/rainlytics/issues/53) paid for a visitor count,
and the [log bucket](../log-bucket/) page has the expiry that decides how long it lasts. A site
running the field set above has none of them to keep.

The salt protects the identifier and never the source. Anyone who can read the log bucket has the
addresses themselves, at better resolution than any digest would give them.

<!-- card
```json
{
  "window": { "granularity": "daily", "from": "2026-08-27T00:00:00.000Z" },
  "visitors": { "distinct": 317, "additive": false }
}
```
-->
