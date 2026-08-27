// What a set of rollups can be saved as, and the rules over the whole set.
//
// Here rather than in `rollup-queries.ts`, because these are facts about the
// names. The one Athena lists a query under, the one CDK builds a logical id
// from, and what a list of rollups has to hold for both to come out unique.
// Each of those rules reads the whole list. `assertRollupName` sees one name
// at a time and can say none of it.

import type { Rollup } from "../rollups.js";

/**
 * Refuses two rollups saved under one name.
 *
 * A saved query is named after its rollup and takes its logical id from the
 * same name. A second rollup called `searches` then reaches CDK as a
 * construct id already in use, and what comes back names a construct and a
 * scope. The rollup and the `rainlytics-searches` the two would share appear
 * nowhere in it.
 *
 * A site replacing a built-in with its own version of the question is how
 * this happens, and leaving the built-in out is what it wanted. The message
 * says so, because the list to filter is the one the caller just passed.
 *
 * @throws {Error} naming the rollup, the saved query and how to replace a
 *   built-in question.
 */
export function assertOneQueryEach(saving: readonly Rollup[]): void {
  const names = saving.map((rollup) => rollup.name);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);

  if (repeated !== undefined) {
    throw new Error(
      `More than one rollup is called "${repeated}", and each would be saved` +
        ` as "rainlytics-${repeated}". Where one of them replaces a built-in` +
        ` question, leave the built-in out: rollups:` +
        ` [...rollups.filter((rollup) => rollup.name !== "${repeated}"),` +
        ` my${queryId(repeated)}]`,
    );
  }
}

/**
 * Refuses a request naming a rollup nothing here is saving.
 *
 * A key is a rollup name typed by hand. `searche` reaches no rollup, and the
 * saved query it was meant for goes on counting every query string on the
 * distribution. That is the failure that prop was added to end. It is caught
 * at synthesis, where somebody can still read the message.
 *
 * @throws {Error} naming the key and the rollups being saved.
 */
export function assertRequestedNames(
  saving: readonly Rollup[],
  requested: readonly string[],
): void {
  const saved = saving.map((rollup) => rollup.name);
  const unknown = requested.filter((name) => !saved.includes(name));

  if (unknown.length > 0) {
    throw new Error(
      `No rollup being saved is called ${listed(unknown)}. The saved` +
        ` queries here are for ${listed(saved)}.`,
    );
  }
}

/** Some names as a message quotes them. */
function listed(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(", ");
}

/**
 * A logical id for one saved query, in the case CDK expects.
 *
 * Two rollups of one name reach this with one id between them.
 * {@link assertOneQueryEach} refuses that before CDK has to.
 */
export function queryId(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}
