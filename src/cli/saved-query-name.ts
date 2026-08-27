// Reading one name off the command line, and finding what it asked for.
//
// The reading and the choosing are here and the running is next door, the
// split `rollup-options.ts` makes for the same reason. A name reaching
// nothing is a mistake in what was typed, and it should be reported as one
// with the names it could have reached.

import { savedQueryPrefix } from "../dataset.js";
import { UsageError } from "./failure.js";
import type { SavedQuery } from "./saved-queries.js";
import { listOf } from "./text-layout.js";

/** The word that selects the command these belong to. */
export const savedQueryCommandName = "saved-query";

/**
 * The name to run, as one argument.
 *
 * @throws {UsageError} where none was given, or where the shell split one
 *   carrying a space.
 */
export function nameFrom(args: readonly string[]): string {
  const [name, ...rest] = args;

  if (name === undefined) {
    throw new UsageError(
      `${savedQueryCommandName} takes the name of a saved query, as in` +
        ` "rainlytics ${savedQueryCommandName} countries".`,
      savedQueryCommandName,
    );
  }

  if (rest.length > 0) {
    throw new UsageError(
      `${savedQueryCommandName} takes one name and got` +
        ` ${String(args.length)}. Athena allows a space in a saved query's` +
        ` name, and a name carrying one has to be quoted or the shell splits` +
        ` it.`,
      savedQueryCommandName,
    );
  }

  return name;
}

/**
 * The saved query a name asked for.
 *
 * An exact match first, then the name with the prefix the construct adds.
 * Somebody reading `rainlytics-countries` out of the console and somebody
 * typing the rollup name they gave it arrive at the same query.
 *
 * A name reaching nothing is answered with the names that are saved. A saved
 * query is deployed from somewhere else and listed in a console the reader
 * may not have open, so "no such query" on its own leaves them guessing at a
 * string.
 *
 * @throws {UsageError} where nothing saved in the workgroup carries the name.
 */
export function savedQueryNamed(
  saved: readonly SavedQuery[],
  name: string,
  workgroup: string,
): SavedQuery {
  const found =
    saved.find((query) => query.name === name) ??
    saved.find((query) => query.name === `${savedQueryPrefix}${name}`);

  if (found !== undefined) {
    return found;
  }

  throw new UsageError(
    saved.length === 0
      ? `Nothing is saved in workgroup ${workgroup}, so there is no` +
          ` "${name}" to run. The RollupQueries construct is what saves a` +
          ` rollup there.`
      : `No query saved in workgroup ${workgroup} is called "${name}". The` +
          ` ones saved there are` +
          ` ${listOf(saved.map((query) => `"${query.name}"`))}.`,
    savedQueryCommandName,
  );
}
