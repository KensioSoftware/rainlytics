# Searches

`rainlytics searches` counts search terms recorded in CloudFront access logs. Use it for a search
endpoint that puts the term in a query-string parameter:

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

Specify the search endpoint with `--path` and the query-string parameter with `--param`. The path
filter excludes unrelated requests that happen to use the same parameter name.

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

`redirected` counts searches that returned status 302, 303 or 307 by default. For example, a
search endpoint may redirect an exact match directly to the matching page.

Permanent redirects are omitted because canonical URL redirects can count one search twice. Change
the statuses when your search endpoint uses another response:

```bash
rainlytics searches \
  --path /search/ \
  --redirect-status 301,302 \
  --last 30d
```

If successful searches and searches with no results both return 200, this rollup cannot tell them
apart. Use a different status or path if you need to measure that distinction.

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
