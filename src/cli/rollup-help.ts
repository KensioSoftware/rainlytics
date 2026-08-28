// The options the four named questions share, and the words that describe
// them.
//
// Apart from the commands for the reason `help-text.ts` is apart from
// `help.ts`. These are documentation, meant to be edited as prose.

import { defaultRedirectStatuses } from "../rollups.js";
import type { CliOption } from "./option.js";

/** How far back a rollup looks when nobody says. */
export const defaultLast = "7d";

/** How many rows a ranked rollup answers with when nobody says. */
export const defaultLimit = 20;

/** The query-string parameter a search is read from when nobody says. */
export const defaultParam = "q";

export const lastOption: CliOption = {
  name: "last",
  short: "l",
  type: "string",
  valueName: "span",
  description:
    `How far back to look, as a whole number of hours, days or weeks:` +
    ` 24h, 7d, 2w. Defaults to ${defaultLast}. The span decides how many` +
    ` stored summaries are read, and how many partitions a --query run` +
    ` scans. A shorter one costs less either way.`,
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
  multiple: true,
  valueName: "prefix",
  description:
    "Count only requests for paths starting with this, so --path /guides/" +
    " covers everything below it. Give it again for each section that" +
    " belongs in one answer, and a request counts when it starts with any" +
    " of them. Matched against the address a reader sees, with" +
    " CloudFront's encoding already taken off. Only a summary computed under" +
    " the same paths can answer it, and a --query run narrows the rows" +
    " counted and leaves the bytes scanned where they were.",
};

export const paramOption: CliOption = {
  name: "param",
  type: "string",
  valueName: "name",
  description:
    `Which query-string parameter carries the term, as in ?q=hello.` +
    ` Defaults to ${defaultParam}. A site with a search box and a legacy tool` +
    ` beside it has two, and they are two questions.`,
};

export const redirectStatusOption: CliOption = {
  name: "redirect-status",
  type: "string",
  valueName: "codes",
  description:
    `Which statuses count as a search sent to what it asked for, separated` +
    ` by commas. Defaults to ${defaultRedirectStatuses.join(",")}. 301 and` +
    ` 308 are left out, because a permanent redirect is address tidying and` +
    ` a reader gets one whatever they typed. One value carrying commas,` +
    ` where --path is given again for each path. A path is long and arrives` +
    ` one at a time, often out of a shell variable, and three status codes` +
    ` are read and typed as one thing.`,
};

export const hostOption: CliOption = {
  name: "host",
  type: "string",
  valueName: "name",
  description:
    "Count only requests for this hostname, for a distribution serving" +
    " several sites. Matched in full rather than as a suffix, so a site and" +
    " its www name are two hosts. Only a summary computed for the same host" +
    " can answer it, and a --query run narrows the rows counted and leaves" +
    " the bytes scanned where they were.",
};
