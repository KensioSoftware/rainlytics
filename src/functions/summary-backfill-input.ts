// The range a backfill payload names, read and checked.
//
// Apart from `summary-run.ts` because a schedule never sends one. A backfill
// is a schedule's own payload with a `backfill` field added by whoever
// invoked the function, so everything else in it is read the way a scheduled
// run reads it, and this reads the one field a schedule leaves out.

import type { BackfillRange } from "../summary-backfill.js";

/**
 * The range a payload asks to backfill, or nothing for a scheduled run.
 *
 * Both ends are ISO 8601 instants. A payload naming a range the job cannot
 * read is refused before Athena is asked anything, rather than computing
 * windows nobody meant.
 *
 * @throws {Error} for a `backfill` field this cannot read, or a range that
 *   ends before it starts.
 */
export function backfillFrom(payload: unknown): BackfillRange | undefined {
  const found = (payload as Readonly<Record<string, unknown>>)["backfill"];

  if (found === undefined) {
    return undefined;
  }

  const asked = (
    typeof found === "object" && found !== null ? found : {}
  ) as Readonly<Record<string, unknown>>;
  const from = instantFrom(asked["from"]);
  const until = instantFrom(asked["until"]);

  if (from === undefined || until === undefined || from >= until) {
    throw new Error(
      `A backfill names the range it covers as {"from": ..., "until": ...},` +
        ` two ISO 8601 instants with "from" the earlier. "until" is outside` +
        ` the range. Got ${JSON.stringify(found)}.`,
    );
  }

  return { from, until };
}

function instantFrom(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const instant = new Date(value);

  return Number.isNaN(instant.getTime()) ? undefined : instant;
}
