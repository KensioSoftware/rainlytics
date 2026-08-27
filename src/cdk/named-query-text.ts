// What a saved rollup calls itself in the Athena console, and what Athena
// will hold.
//
// Here rather than in `rollup-queries.ts`, because these are facts about
// `CreateNamedQuery` and about the command line, and the construct is what
// puts a resource in a template. The limits in particular are the API's, and
// they would go on being the API's if nothing ever saved a rollup again.

import { rollups } from "../rollup-questions.js";
import type { Rollup, RollupRequest } from "../rollups.js";

/**
 * What Athena holds a named query's name and description in.
 *
 * `CreateNamedQuery` takes 128 characters of the one and 1,024 of the other.
 * The five rollups built in are nowhere near either. A rollup a site wrote is
 * bounded by nothing, since `summary` is meant to be one line and the type
 * has no way to say so.
 */
const athenaTakes = { name: 128, description: 1024 } as const;

/**
 * What one saved query says about itself in the console.
 *
 * The five Rainlytics ships name the command that runs them, because somebody
 * reading one in the console wants to know which `rainlytics` subcommand it
 * answers. A rollup a site wrote has no subcommand, and naming one would send
 * its reader to a command that does not exist.
 *
 * Then what the copy covers, from {@link covering} below.
 */
export function describing(rollup: Rollup, request: RollupRequest): string {
  const command = rollups.includes(rollup)
    ? ` What "rainlytics ${rollup.name}" runs.`
    : "";

  return `${rollup.summary}${command} ${covering(rollup, request).join(", ")}.`;
}

/**
 * The clauses saying what one saved copy counts.
 *
 * The range, the host and the sections it was narrowed to, the parameter a
 * search reads, and whether automated traffic is counted. Each of those
 * changes the answer, and a copy answering a narrower question than its name
 * promises is what the narrowing was added to say out loud.
 *
 * Several sections are joined by "or". That is what the SQL underneath does
 * with them, and it keeps them apart from the commas joining the clauses
 * around them.
 *
 * The parameter is named on every copy of a rollup that reads one, whether
 * or not the deployment chose it. `param` falls back to `q`, and a site whose
 * box carries the term under another name has a saved query answering with an
 * empty table and no sign of why.
 *
 * `limit` is left out. A row count decides how much of the answer is printed
 * and leaves what was counted where it was. It sits on the last line of the
 * SQL below.
 */
function covering(rollup: Rollup, request: RollupRequest): readonly string[] {
  const paths = request.paths ?? [];

  return [
    "Over the current month",
    ...(request.host === undefined ? [] : [`on ${request.host}`]),
    ...(paths.length === 0 ? [] : [`under ${paths.join(" or ")}`]),
    ...(rollup.namesAParameter === true
      ? [`reading the "${request.param}" parameter`]
      : []),
    ...(request.includeBots ? ["counting automated traffic"] : []),
  ];
}

/**
 * Refuses a name or a description Athena would turn the deploy back for.
 *
 * At synthesis, where somebody can still change it. The alternative is a
 * `cdk deploy` that runs for a while and then fails on a validation message
 * naming a field rather than a rollup.
 *
 * @throws {Error} for a value longer than Athena takes.
 */
export function assertAthenaLength(
  what: "name" | "description",
  value: string,
): void {
  if (value.length > athenaTakes[what]) {
    throw new Error(
      `The saved query ${what} is ${String(value.length)} characters and` +
        ` Athena takes ${String(athenaTakes[what])}. Shorten the rollup's` +
        ` ${what === "name" ? "name" : "summary"}: ${value.slice(0, 60)}`,
    );
  }
}
