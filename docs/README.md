# Rainlytics documentation

Rainlytics is experimental and pre-1.0. The construct API moves without a major version behind it,
because the only consumer so far is the maintainer's own sites.

Pages here are copied to [rainlytics.com](https://rainlytics.com) by that site's scaffold. Each one
needs an H1 and a trailing `<!-- card -->` block. `scripts/sh/docs-check.sh` holds the contract and
runs on every `pnpm check`.

## Constructs

- [Log bucket](log-bucket/), where CloudFront delivers raw access logs.
- [Log delivery](log-delivery/), which points a distribution at that bucket.
- [Log table](log-table/), the Glue table Athena reads what landed there.
- [Query workgroup](query-workgroup/), which bounds what one query can scan and cost.

## Reading the data back

- [Command line](command-line/), the `rainlytics` command and what it writes.
