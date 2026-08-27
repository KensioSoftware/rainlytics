// Writing a value into SQL text.
//
// Its own module because both of the two that write SQL text need it.
// `rollup-rows.ts` quotes the host and path a request narrowed to, and
// `log-encoding.ts` quotes the query-string parameter a rollup reads. Left
// where it started, in `rollup-rows.ts`, the two would import each other.

/** One value as SQL writes it, with any quote in it doubled. */
export function quoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
