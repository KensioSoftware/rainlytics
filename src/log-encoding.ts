// Reading CloudFront's encoding back off a delivered column.
//
// Here rather than beside the questions, because two halves need it and they
// sit on opposite sides of the dependency. `rollup-questions.ts` decodes the
// path it groups by, and `rollup-rows.ts` decodes the same column to match
// `--path` against it. A copy in each would be two definitions of one rule,
// and the way they drift is a filter that stops agreeing with the column it
// filters.
//
// The same argument reaches past this package, as it does for `rowsFor`. A
// site writing a rollup of its own reads the same doubly encoded log, and
// both of these are exported from the package root for that. A hand-written
// copy of either expression arrives in the site's repository with none of the
// reasoning below it.

import { quoted } from "./sql-text.js";

/**
 * One column with CloudFront's encoding taken back off it.
 *
 * CloudFront percent-encodes every value it writes into a log record, and a
 * request URI reaches it already carrying the browser's own encoding, so a
 * page at `/words/好/` is recorded as `/words/%25E5%25A5%25BD/`. Two passes
 * are what reads that back. One returns `/words/%E5%A5%BD/`, which is the URI
 * the browser sent and reads no better than the record.
 *
 * `url_extract_path` is no shortcut. It answers with the path as the text
 * wrote it, escapes and all.
 *
 * Two limits, both written up on the rollups docs page. `url_decode` reads
 * `+` as a space, which is right for a query string and wrong for a path,
 * where `+` is a literal. And Athena raises over an escape naming no byte,
 * such as `%zz`, where Yulin answers null. `try` is the guard for that and
 * Yulin has no `try` to test against, so a path carrying one that still
 * answered HTML would fail the query outright.
 *
 * ```typescript
 * `SELECT ${decodedColumn("cs_uri_stem")} AS path, count(*) AS views`;
 * ```
 */
export function decodedColumn(column: string): string {
  return `url_decode(url_decode(${column}))`;
}

/**
 * One query-string parameter, read out of a record and decoded.
 *
 * One `url_decode` here against the two in {@link decodedColumn}, because
 * `url_extract_parameter` decodes its own answer. Trino splits the query
 * string and runs `URLDecoder.decode` over what it finds, so the doubly
 * encoded value a record holds is left needing one further pass. Two passes
 * here would decode a term that happens to hold a percent sequence twice, and
 * `50%` typed into a search box is the case.
 *
 * A record carries no whole URL. The path and the query are columns of their
 * own, so they are joined with the `?` that was between them before
 * CloudFront split them up. Both column names are written here and not asked
 * of a caller. A record holds one query string in one column, and a caller
 * passing those names would be passing the only answer there is.
 *
 * `url_decode` reads `+` as a space, which is what a form submits.
 *
 * ```typescript
 * `SELECT ${decodedParameter("utm_campaign")} AS campaign`;
 * ```
 */
export function decodedParameter(parameter: string): string {
  const wholeUrl = "cs_uri_stem || '?' || cs_uri_query";

  return `url_decode(url_extract_parameter(${wholeUrl}, ${quoted(parameter)}))`;
}
