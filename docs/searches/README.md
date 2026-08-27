# Searches

What people typed into a site's search box, counted off the access log.

```bash
rainlytics searches --path /search/ --last 30d
```

```text
term      searches  redirected
--------  --------  ----------
好              41          38
happy           12           0
```

What readers search for says which pages to write next, and a site usually has no record of it. The
terms are in the access log already. CloudFront records `cs-uri-query` whatever the cache key and
origin forwarding are set to, so a search answered from the edge is counted alongside one that
reached the origin. No other source covers both.

Nothing about who searched is recorded anywhere. `c-ip` and `cs(Cookie)` are left out of the
delivered field set on purpose, and the [log table](../log-table/) page says why.

## Name the search page

`--path` is what separates a search from every other query string the same log holds. A site's
analytics beacon, its legacy tools and the tracking parameters on inbound links are all in there,
and counting them together answers nothing.

```bash
rainlytics searches --path /search/ --last 30d
rainlytics searches --path /tools/convert/ --param hanzi --last 30d
```

A site with two search boxes gives `--path` once for each, and every row names the box it came from:

```bash
rainlytics searches --path /words/search/ --path /sentences/search/ --last 30d
```

```text
term      section             searches  redirected
--------  ------------------  --------  ----------
happy     /words/search/            41          38
happy     /sentences/search/        12           0
```

Two corpora give two answers to the same word. The `section` column names the box a row came from,
written out of the same test that let the row in. Where two of the prefixes overlap (`/guides/`
given alongside `/guides/advanced/`) a row reports the first of them given, and every row is in
exactly one section.

One `--path` leaves the column out, since every row would carry the same value. One run still reads
both boxes for one query's money, where two runs would be two questions and two bills.

`--param` names the parameter carrying the term and defaults to `q`. One site can hold several, and
each is its own question. `--redirect-status` names what counts as a search sent to its answer, and
[the section below](#which-statuses-count) covers it. Everything else the rollups take works here
too, `--host`, `--limit` and `--include-bots` among them. See [rollups](../rollups/).

## `redirected` is how many found a page

A site that answers an exact match by sending the reader straight to its page can read that column
as the searches that found one. The rest produced a list.

```text
term      searches  redirected
--------  --------  ----------
好              41          38
happy           12           0
```

`好` is a word the site publishes, and nearly every search for it goes straight there. Nobody
searching `happy` was sent anywhere, so those twelve readers got a list.

### Which statuses count

302, 303 and 307. Those are what a site answers when it sends a reader to the thing they searched
for.

301 and 308 are left out, because a permanent redirect is address tidying. A reader gets one
whatever they typed. A site answering `/search?q=happy` with a 308 to `/search/?q=happy` carries the
term on the redirect and again on the request behind it, and counting the 308 reports one reader as
two searches and puts `happy` on the same line as a term the site publishes a page for. A
canonical-host 301 does it again.

A site whose exact match answers 301 names its own:

```bash
rainlytics searches --path /search/ --redirect-status 301,302 --last 30d
```

One value carrying commas, where `--path` is given again for each path. A path is long and arrives
one at a time, often out of a shell variable. Three status codes are read and typed as one thing.

### An empty result reads as a list

What the access log cannot tell you is whether that list had anything in it. The record carries the
status, the path and the query, and a ranked list and an empty result are both 200. Separating them
is work for the site being measured, which has to make the two differ in one of those three fields
before any log-based report can pick them apart. A distinct status for an empty result is the
usual lever.

## The term is decoded once

CloudFront percent-encodes what it writes and the browser has already encoded the term, so `家`
reaches the log as `%25E5%25AE%25B6`. The rollup reads it with `url_extract_parameter`, which
decodes its own answer, and one further `url_decode` finishes the job.

That is one pass where [pageviews](../rollups/#the-log-is-percent-encoded-twice) needs two, and the
difference is the extract function rather than the data. Two passes here would decode a term
holding a percent sequence twice, and `50%` typed into a search box is the case.

A space arrives as `+` from a form and as `%20` from a hand-written link, and both come back as a
space. The two spellings of one search are one row.

<!-- card
```bash
rainlytics searches --path /search/ --last 30d
```
-->
