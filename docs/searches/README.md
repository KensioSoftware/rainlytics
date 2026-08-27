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

A site with two search boxes gives `--path` once for each, and the terms from both are counted
together:

```bash
rainlytics searches --path /words/search/ --path /sentences/search/ --last 30d
```

Two runs would answer two questions, and adding those answers up by hand is the arithmetic the
command was there to do.

`--param` names the parameter carrying the term and defaults to `q`. One site can hold several, and
each is its own question. Everything else the rollups take works here too, `--host`, `--limit` and
`--include-bots` among them. See [rollups](../rollups/).

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
