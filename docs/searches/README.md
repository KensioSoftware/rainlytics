# Searches

`rainlytics searches` counts terms submitted to a search page from the CloudFront access log.

```bash
rainlytics searches --path /search/ --last 30d
```

```text
term      searches  redirected
--------  --------  ----------
rain            41          38
weather         12           0
```

CloudFront records the query string for cached and uncached requests. Rainlytics reads the term but
does not include the viewer address in the result.

## Name the search path and parameter

The path distinguishes search requests from tracking parameters, beacon events and other query
strings on the site.

```bash
rainlytics searches --path /search/ --param q --last 30d
rainlytics searches --path /tools/convert/ --param text --last 30d
```

`--param` defaults to `q`.

Repeat `--path` for several search pages:

```bash
rainlytics searches \
  --path /docs/search/ \
  --path /api/search/ \
  --last 30d
```

The result then includes a `section` column. If prefixes overlap, the first matching path on the
command line wins.

## Redirected searches

`redirected` counts searches that received a temporary redirect. The defaults are 302, 303 and 307. This can represent an exact match that sent the reader directly to a page.

Permanent redirects are omitted because canonical URL redirects can count one search twice. Change
the statuses when your search endpoint uses another response:

```bash
rainlytics searches \
  --path /search/ \
  --redirect-status 301,302 \
  --last 30d
```

The access log cannot tell a nonempty result list from an empty one when both return 200. Use a
different status or path if that distinction belongs in analytics.

## Stored searches

Configure the scheduled question with the same path and parameter:

```typescript
new RollupSummaries(this, "Summaries", {
  table,
  workgroup,
  requests: {
    searches: { paths: ["/search/"], param: "q" },
  },
});
```

A command that omits `--path` and `--param` adopts the values recorded in the stored summaries. A
different value requires `--query`.

CloudFront encodes the browser's query string again when writing the log. The rollup extracts the
parameter and decodes the term once more. Form `+` and URL `%20` spaces therefore group together.

<!-- card
```bash
rainlytics searches --path /search/ --last 30d
```
-->
