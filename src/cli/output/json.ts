// The result as JSON, which is what everything downstream of a pipe reads.
//
// An array of objects, one per row, and never an envelope around it. `jq
// '.[0].path'` is the shape people already know, and a wrapper would put a
// key in front of every expression anybody writes.

import type { CommandResult, Row } from "./result.js";

/*
 * What a missing cell becomes.
 *
 * JSON has no `undefined`. A key present in some objects and absent from
 * others makes the output awkward to read with anything, so every object
 * carries every column and an empty one is null.
 */
// oxlint-disable-next-line unicorn/no-null
const absent = null;

/** The result as pretty-printed JSON, ending in a newline. */
export function toJson(result: CommandResult): string {
  const objects: readonly Row[] = result.rows.map((row) =>
    Object.fromEntries(
      result.columns.map((column) => [column, row[column] ?? absent]),
    ),
  );

  return `${JSON.stringify(objects, undefined, 2)}\n`;
}
