// The options the named questions share, and the words that describe them.
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
    ` 24h, 7d, 2w. Defaults to ${defaultLast} where no --day or --from is` +
    ` given. The span decides how many stored summaries are read, and how` +
    ` many partitions a --query run scans. A shorter one costs less either` +
    ` way.`,
};

export const dayOption: CliOption = {
  name: "day",
  type: "string",
  valueName: "date",
  description:
    "One UTC day, as YYYY-MM-DD, from its midnight to the next. Reads that" +
    " day's stored summary and nothing either side of it, which is how a" +
    " question answering from one stored window, such as a conversion rate," +
    " is read for a day. Cannot be given with --last, --from or --until.",
};

export const fromOption: CliOption = {
  name: "from",
  type: "string",
  valueName: "instant",
  description:
    "Where the span starts, as YYYY-MM-DD for midnight UTC or as an ISO 8601" +
    " instant with its offset, such as 2026-10-01T06:00Z. Spans written as" +
    " days read whole stored days and nothing short of them. Cannot be given" +
    " with --last or --day.",
};

export const untilOption: CliOption = {
  name: "until",
  type: "string",
  valueName: "instant",
  description:
    "Where the span ends, written the same way as --from and outside the" +
    " span, so --from 2026-10-01 --until 2026-11-01 is October. Defaults to" +
    " now. Needs --from.",
};

export const includeBotsOption: CliOption = {
  name: "include-bots",
  type: "boolean",
  description:
    "Count automated traffic too. Left out by default, because crawlers are" +
    " most of a quiet site's requests and a count including them says more" +
    " about them than about anybody. See the docs for what is matched.",
};

export const botUserAgentOption: CliOption = {
  name: "bot-user-agent",
  type: "string",
  multiple: true,
  valueName: "text",
  description:
    "Treat a request whose user agent contains this as automated, beside" +
    " the bot, crawl, spider and slurp the filter always matches. For a" +
    " crawler that names itself without any of them, such as" +
    " GeedoShopProductFinder. Matched literally and without regard to case," +
    " against the user agent as CloudFront logged it, so it cannot hold a" +
    " space." +
    " Give it again for each crawler. --include-bots still counts them all." +
    " Only a summary computed with the same list can answer it.",
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

export const countryOption: CliOption = {
  name: "country",
  type: "string",
  multiple: true,
  valueName: "code",
  description:
    "Count only requests from this country, as the two-letter code" +
    " CloudFront writes, such as GB. Give it again for each country that" +
    " belongs in one answer, and a request counts when it came from any of" +
    " them. For a site whose customers are all in one place, where" +
    " automated traffic from elsewhere passes the bot filter. CloudFront" +
    " reads the country off the address, so a customer abroad or on a VPN" +
    " is left out. Only a summary computed for the same countries can answer" +
    " it, and a --query run narrows the rows counted and leaves the bytes" +
    " scanned where they were.",
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
