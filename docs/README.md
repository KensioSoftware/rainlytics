# Rainlytics documentation

Rainlytics is experimental and pre-1.0. The construct API moves without a major version behind it,
because the only consumer so far is the maintainer's own sites.

Pages here are copied to [rainlytics.com](https://rainlytics.com) by that site's scaffold. Each one
needs an H1 and a trailing `<!-- card -->` block. `scripts/sh/docs-check.sh` holds the contract and
runs on every `pnpm check`.

## Constructs

- [Beacon path](beacon-path/), which answers the beacon's collection path with a 204 at the edge.
- [Log bucket](log-bucket/), where CloudFront delivers raw access logs.
- [Log delivery](log-delivery/), which points a distribution at that bucket.
- [Log table](log-table/), the Glue table Athena reads what landed there.
- [Query workgroup](query-workgroup/), which bounds what one query can scan and cost.
- [Rollup queries](rollups/#the-same-sql-saved-in-the-console), the same SQL saved in Athena.
- [Summary schedule](summary-schedule/), which computes the questions on a timer and stores the
  answers.

## In the browser

- [Browser beacon](beacon/), which reports the route changes and custom events a server log cannot
  see.

## Reading the data back

- [Command line](command-line/), the `rainlytics` command and what it writes.
- [Rollups](rollups/), the named questions, what each counts, and how to write one of your own.
- [Beacon events](beacon-events/), what the beacon reported, with a flood of it bounded.
- [JavaScript errors](javascript-errors/), uncaught exceptions and rejections by page and message.
- [Web Vitals](web-vitals/), p75 for each vital reported through the beacon.
- [Searches](searches/), what readers typed into a search box.
- [Query](query/), running SQL against the log table with `rainlytics query`.
- [Rollup summaries](summaries/), the schema for the precomputed answers the commands read.
- [Counting visitors](visitors/), what a visitor count means and over what window.

## Cost

- [Abusing the collection path](abuse/), what an open collection path exposes, and the prices for
  containing it.
