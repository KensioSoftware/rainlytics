// What leaves automated traffic out of a rollup, as conditions.
//
// Apart from `rollup-rows.ts`, which joins these onto every question's
// `WHERE` clause unless the request counts bots.

import type { RollupRequest } from "./rollups.js";
import { botUserAgentPattern } from "./rollups.js";
import { quoted } from "./sql-text.js";

/**
 * The bot filter, being the four built-in substrings and any a site added.
 *
 * The four are one pattern, since they are fixed text this module wrote. A
 * site's own are a `strpos` test each, for the reason `startingWithAny` in
 * `rollup-rows.ts` gives. A crawler's name is matched literally, and a `.` in
 * one would be a wildcard in a pattern. Each is folded to lower case here as
 * well as in the column, so `GeedoShopProductFinder` written as it appears in
 * the log matches. `includeBots` lifts the four and a site's own together.
 *
 * The column is matched as CloudFront wrote it, which percent-encodes a
 * space as `%20`. A substring holding a space would match nothing, so one is
 * refused along with an empty one, which every user agent contains.
 *
 * @throws {Error} for an empty substring or one holding whitespace.
 */
export function automatedLeftOut(request: RollupRequest): readonly string[] {
  const added = request.botUserAgents ?? [];
  const refused = added.find((agent) => !isBotUserAgent(agent));

  if (refused !== undefined) {
    throw new Error(
      `The bot user agent "${refused}" cannot be matched. Name one run of` +
        ` the user agent with no spaces in it, such as productfinder.` +
        ` CloudFront logs a space as %20, and an empty one would match every` +
        ` request.`,
    );
  }

  return [
    `NOT regexp_like(lower(cs_user_agent), ${quoted(botUserAgentPattern)})`,
    ...added.map(
      (agent) =>
        `strpos(lower(cs_user_agent), ${quoted(agent.toLowerCase())}) = 0`,
    ),
  ];
}

/**
 * Whether a bot filter can match a substring, being one that is not empty and
 * holds no whitespace.
 *
 * Exported for the command line too, which refuses the same values as a
 * usage error before any SQL is written.
 */
export function isBotUserAgent(agent: string): boolean {
  return /^\S+$/u.test(agent);
}
