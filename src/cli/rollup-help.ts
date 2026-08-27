// The options the four named questions share, and the words that describe
// them.
//
// Apart from the commands for the reason `help-text.ts` is apart from
// `help.ts`. These are documentation, meant to be edited as prose.

import type { CliOption } from "./option.js";
import { databaseOption, workgroupOption } from "./query-help.js";

/** How far back a rollup looks when nobody says. */
export const defaultLast = "7d";

/** How many rows a ranked rollup answers with when nobody says. */
export const defaultLimit = 20;

export const lastOption: CliOption = {
  name: "last",
  short: "l",
  type: "string",
  valueName: "span",
  description:
    `How far back to look, as a whole number of hours, days or weeks:` +
    ` 24h, 7d, 2w. Defaults to ${defaultLast}. The span decides which` +
    ` partitions are read, so a shorter one costs less.`,
};

export const includeBotsOption: CliOption = {
  name: "include-bots",
  type: "boolean",
  description:
    "Count automated traffic too. Left out by default, because crawlers are" +
    " most of a quiet site's requests and a count including them says more" +
    " about them than about anybody. See the docs for what is matched.",
};

export const limitOption: CliOption = {
  name: "limit",
  short: "n",
  type: "string",
  valueName: "rows",
  description: `How many rows to answer with. Defaults to ${String(defaultLimit)}.`,
};

export const pathOption: CliOption = {
  name: "path",
  short: "p",
  type: "string",
  valueName: "prefix",
  description:
    "Count only requests for paths starting with this, so --path /guides/" +
    " covers everything below it. Matched against the address a reader" +
    " sees, with CloudFront's encoding already taken off. It narrows the" +
    " rows counted and leaves the bytes scanned where they were.",
};

export const hostOption: CliOption = {
  name: "host",
  type: "string",
  valueName: "name",
  description:
    "Count only requests for this hostname, for a distribution serving" +
    " several sites. Matched in full rather than as a suffix, so a site and" +
    " its www name are two hosts. It narrows the rows counted and leaves" +
    " the bytes scanned where they were.",
};

/**
 * Every option one rollup command accepts, in the order help prints them.
 *
 * Assembled here beside the descriptions rather than next to the command, so
 * that adding an option is one edit in one file. The row limit is the only
 * one that varies, and the rollup answering a single row has nothing to
 * limit.
 */
export function rollupOptions(isRanked: boolean): readonly CliOption[] {
  return [
    lastOption,
    pathOption,
    hostOption,
    includeBotsOption,
    ...(isRanked ? [limitOption] : []),
    databaseOption,
    workgroupOption,
  ];
}
