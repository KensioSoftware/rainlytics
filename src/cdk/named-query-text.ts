// What a saved rollup calls itself in the Athena console, and what Athena
// will hold.
//
// Here rather than in `rollup-queries.ts`, because these are facts about
// `CreateNamedQuery` and about the command line, and the construct is what
// puts a resource in a template. The limits in particular are the API's, and
// they would go on being the API's if nothing ever saved a rollup again.

import { rollups } from "../rollup-questions.js";
import type { Rollup } from "../rollups.js";

/**
 * What Athena holds a named query's name and description in.
 *
 * `CreateNamedQuery` takes 128 characters of the one and 1,024 of the other.
 * The four rollups built in are nowhere near either. A rollup a site wrote is
 * bounded by nothing, since `summary` is meant to be one line and the type
 * has no way to say so.
 */
const athenaTakes = { name: 128, description: 1024 } as const;

/**
 * What one saved query says about itself in the console.
 *
 * The four Rainlytics ships name the command that runs them, because somebody
 * reading one in the console wants to know which `rainlytics` subcommand it
 * answers. A rollup a site wrote has no subcommand, and naming one would send
 * its reader to a command that does not exist.
 */
export function describing(rollup: Rollup): string {
  const command = rollups.includes(rollup)
    ? ` What "rainlytics ${rollup.name}" runs.`
    : "";

  return `${rollup.summary}${command} Over the current month.`;
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
