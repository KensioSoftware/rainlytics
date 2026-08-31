# What abusing the collection path costs

The beacon reports to a path on the site's own domain, and CloudFront records the request in the
access log like any other. The path is open and unauthenticated. Anybody can send that URL a
million times and have every one of them counted, carrying a page value naming a page nobody opened and an event that
never happened.

Two things follow, and they want different answers. The counts recover. The money is spent.

## Layer 1 is open in the same way

This comes first because the beacon looks like the thing that opened the door.

A site's own pages take a request from anybody. A million requests for a real page put a million
rows in the log. Each one is a GET that answered HTML and succeeded, and that is the whole of what
`pageviews` asks of a row, so the count follows the flood up. The [crawler
filter](../rollups/#crawlers-are-most-of-the-traffic) catches a flood naming itself a bot and
nothing else about it. Every analytics product built on server logs works this way. A log records
what arrived and has no way to ask why.

What layer 2 adds is a forged page value and events nobody caused. The gap is narrower than it
looks. A spammed page request already lies about which page was read, and it transfers the page body
to do it. A spammed beacon request carries no body in either direction.

## The counts recover

The raw store is immutable and every rollup is rebuilt from it. A poisoned window is a re-run under
a better filter.

[#104](https://github.com/KensioSoftware/rainlytics/issues/104) chose that filter and
[`beacon-events`](../beacon-events/) applies it. One visitor's identical events are counted no more
than 60 times an hour, which is one a minute from one person, on one page, of one event name. It
sits in the rollup query, beside the crawler filter every question already applies. The raw store
keeps every row and the query decides what to count. A rule that turns out to be wrong is another
re-run.

The [log bucket's](../log-bucket/) expiry is the outer limit on this. A window that has aged past it
has no rows left to recount, under any filter at all. A year is the default.

## The money is spent

A re-run fixes a number. Nothing re-runs a bill. Every spammed request buys two charges outright
and arms a third, and no filter written afterwards takes any of them back.

**A CloudFront request.** The distribution charges per request at its own rate, and that charge
lands on the CDN bill whether Rainlytics is installed or not. A request for a real page costs the
same and transfers a page body on top of it. Whatever answers the collection path is priced per hit
too, and [#99](https://github.com/KensioSoftware/rainlytics/issues/99) settled on a [CloudFront
Function](../beacon-path/) at $0.10 per million invocations.

**A log record, kept for the bucket's retention.**
[#9](https://github.com/KensioSoftware/rainlytics/issues/9) measured the log store at $0.084 a month
on a site serving 137,000 requests a day, which works out near $0.02 per million requests. It splits
between one PUT per delivered object and steady-state storage under the 370-day expiry. CloudFront
delivers into the bucket at no charge, which made that figure the whole of what Rainlytics itself
cost on that site. A flood pays the rate on the way in and then pays the storage every month until
the expiry drops it.

**Bytes that a query over the window scans.** This is the armed one. Athena bills $5.00 per terabyte,
and the charge arrives only when something reads the window (a scheduled rollup, or a `--query` run
for a fresher answer). Spammed rows sit in the same objects as real ones and no partition predicate
tells them apart, so each run that covers the window reads them again for as long as it stays in
range.

That third charge already has a ceiling. The [query workgroup's](../query-workgroup/) bytes-scanned
cutoff fails a query at ten gibibytes, which caps one query near five cents whatever the flood put in
the window. It binds queries naming the workgroup, being `rainlytics` unless a deployment renamed it.
Athena's own `primary` workgroup has no cutoff, and a query landing there is uncapped. The first two
charges have no ceiling anywhere.

## AWS WAF, and why it stays out of the default

WAF is the one place at the edge where a request count can be kept, and it is priced in the open.
Read from the AWS WAF pricing page on 2026-08-29:

- $5.00 a month per web ACL
- $1.00 a month per rule
- $0.60 per million requests inspected

A rate-based rule is an ordinary rule at $1.00. So the smallest configuration that would help, one
web ACL carrying one rate-based rule on the collection path, is $6.00 a month before a single request
reaches it.

Set that beside the $0.084 a month #9 measured. WAF is a fixed floor around seventy times the log
store it protects, and it is billed in full in a quiet month when nobody attacks anything. Every
other charge on this page is priced by use, and this would be the largest line on a quiet site's
bill.

That answer flips for a site already running a web ACL for other reasons. The $5.00 is paid, the
rule is $1.00, and the collection path joins something that exists. The default is for a site
installing Rainlytics, where the ACL would exist for this alone.

## Why the count has to live in WAF

Rate limiting needs a count that survives between requests, and the edge has nowhere to keep one.

- **CloudFront Functions** hold no state between invocations. A function sees one request and
  forgets it.
- **CloudFront KeyValueStore** is read-only from function code. A function reads what a deploy put
  there and cannot write a counter back.
- **Shield Standard** comes at no charge and works at the network layer. Ten well-formed HTTPS
  requests a second look like traffic to it.
- **Shield Advanced** carries the application-layer protection and costs $3,000 a month.

## A budget alarm is the honest answer

An exposure that outlasts every attempt to prevent it is one to be told about. AWS Budgets gives an
account its first two budgets at no charge, and a cost alarm is one of them.

Put one on the account carrying the distribution and the log bucket, with a threshold above what a
quiet month costs (#9's figure is the right shape for a site of that size, and a month of real
billing is better). An alert firing at twice a normal month is a flood in progress. The decision
about WAF is then taken with a bill in hand, which beats guessing at one during a deploy.

## No WAF construct ships here

Every resource Rainlytics creates is priced by use, and a construct putting $6.00 a month into the
default path would break that for every site installing it. Whether the $6.00 is worth paying
depends on what a site is worth attacking, what else its account already runs, and what its owner
wants to spend. That is the site's decision, and it is taken with information the library lacks.

A site taking it writes the web ACL in its own CDK app and associates it with the distribution. The
collection path is `/_rainlytics` unless a site names another, and it is exported as
`defaultBeaconPath` from the package root, so a rate-based rule can scope itself to the same path
the beacon reports to.

<!-- card
```text
one web ACL and one rate-based rule    $6.00 a month
the log store #9 measured             $0.084 a month
a budget alarm watching for a flood        no charge
```
-->
