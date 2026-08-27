// The options the four named questions share, and the words that describe
// them.
//
// Apart from the commands for the reason `help-text.ts` is apart from
// `help.ts`. These are documentation, meant to be edited as prose.

import type { CliOption } from "./option.js";

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
