// Writing a value into SQL text.
//
// Its own module because all three that write SQL text need it.
// `rollup-rows.ts` quotes the host and path a request narrowed to,
// `log-encoding.ts` quotes the query-string parameter a rollup reads, and
// `rollup-questions.ts` writes the statuses a search counts as a redirect.
// Left where it started, in `rollup-rows.ts`, the first two would import
// each other.

/** One value as SQL writes it, with any quote in it doubled. */
export function quoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * A column holding any one of a list of values, as a condition.
 *
 * An empty list is `false`. Nothing matches nothing, and `IN ()` is not
 * something Athena parses.
 */
export function oneOf(column: string, values: readonly string[]): string {
  if (values.length === 0) {
    return "false";
  }

  return `${column} IN (${values.map((value) => quoted(value)).join(", ")})`;
}
