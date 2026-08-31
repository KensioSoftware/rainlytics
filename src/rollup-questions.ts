// The six default questions, written out.
//
// Each is a `SELECT` over the same filtered rows, so what differs between
// them is the thing being counted. The filters are in `rollups.ts`, because
// every one of these leaves out the same automated traffic by default and a
// rollup that filtered differently would answer a different question from
// its neighbours without saying so.

import { defaultBeaconPath } from "./beacon-events.js";
import { outsideTheBeaconPath } from "./beacon-rows.js";
import { qualifiedTableName } from "./dataset.js";
import { decodedColumn, decodedParameter } from "./log-encoding.js";
import {
  browserTotals,
  cacheTotals,
  pageviewTotals,
  referrerTotals,
  searchTotals,
  statusTotals,
} from "./rollup-question-totals.js";
import type { Rollup, RollupRequest } from "./rollups.js";
import { matchedPath, rowsFor } from "./rollups.js";
import { oneOf, quoted } from "./sql-text.js";

/**
 * The `text/html` responses a person actually looked at.
 *
 * Exported for `visitor-counts.ts`, which counts visitors over exactly these
 * rows. A copy there would be a second definition of what a pageview is, and
 * a summary reporting more visitors than views is how the drift would show.
 */
export const aPageView: readonly string[] = [
  "cs_method = 'GET'",
  "sc_content_type LIKE 'text/html%'",
  "sc_status IN ('200', '304')",
];

/** What CloudFront writes where a field was empty. */
const empty = "'-'";

/** The result types where the cache had a say. */
const cacheHit = "x_edge_result_type IN ('Hit', 'RefreshHit')";
const cacheDecided = "x_edge_result_type IN ('Hit', 'RefreshHit', 'Miss')";

const counted = (condition: string): string =>
  `sum(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;

/**
 * A response one request counts as a redirect to what somebody searched for.
 *
 * `sc_status` is delivered as text, which is why the codes go in quoted.
 */
const aRedirect = (request: RollupRequest): string =>
  oneOf("sc_status", request.redirectStatuses);

/**
 * The order a ranked rollup answers in.
 *
 * Most first, and the thing being counted second. Two paths with the same
 * number of views are otherwise ordered by whatever the engine finds
 * convenient, which is stable within a run and not across two of them. A
 * person comparing this week against last wants the tie broken the same way
 * both times.
 */
const rankedOrder = "  ORDER BY 2 DESC, 1";

/** How many rows a ranked rollup answers with. */
const limitOf = (request: RollupRequest): string =>
  `  LIMIT ${String(request.limit)}`;

/** The user agent as each classifier reads it. */
const userAgent = "lower(cs_user_agent)";

/** One branch in a user-agent classifier. */
interface UserAgentClass {
  /** The condition that assigns the class. */
  readonly when: string;

  /** The value written into the answer. */
  readonly value: string;
}

/** A fixed classification ladder, with unmatched agents kept visible. */
const userAgentClassifier = (classes: readonly UserAgentClass[]): string =>
  [
    "CASE",
    ...classes.map(
      (entry) => `    WHEN ${entry.when} THEN ${quoted(entry.value)}`,
    ),
    `    ELSE ${quoted("Other")}`,
    "  END",
  ].join("\n");

/**
 * A browser family read from compatibility tokens in a user agent.
 *
 * Specific Chromium browsers come before Chrome, and every Chromium branch
 * comes before Safari. Their agents carry the more general tokens too.
 */
const browserFamily = userAgentClassifier([
  {
    when: `regexp_like(${userAgent}, 'edg(e|a|ios)?/')`,
    value: "Edge",
  },
  {
    when: `regexp_like(${userAgent}, '(opr|opera|opios)/')`,
    value: "Opera",
  },
  {
    when: `regexp_like(${userAgent}, 'samsungbrowser/')`,
    value: "Samsung Internet",
  },
  {
    when: `regexp_like(${userAgent}, '(firefox|fxios)/')`,
    value: "Firefox",
  },
  {
    when: `regexp_like(${userAgent}, '(chrome|crios|chromium)/')`,
    value: "Chrome family",
  },
  { when: `regexp_like(${userAgent}, 'safari/')`, value: "Safari family" },
]);

/**
 * A coarse device class read from conventional user-agent tokens.
 *
 * An explicit tablet wins over `mobile`. Android agents left after the
 * mobile branch are treated as tablets, following the convention that
 * Android phones carry `Mobile` and Android tablets do not.
 */
const deviceClass = userAgentClassifier([
  {
    when: `regexp_like(${userAgent}, 'ipad|tablet|kindle|silk/|playbook')`,
    value: "Tablet",
  },
  {
    when:
      `regexp_like(${userAgent},` +
      ` 'mobile|iphone|ipod|windows(%20| )phone|blackberry|bb10')`,
    value: "Mobile",
  },
  { when: `regexp_like(${userAgent}, 'android')`, value: "Tablet" },
  {
    when:
      `regexp_like(${userAgent},` +
      ` 'windows(%20| )nt|macintosh|x11|cros|linux')`,
    value: "Desktop",
  },
]);

/** The pages people looked at, most looked at first. */
export const pageviews: Rollup = {
  name: "pageviews",
  summary: "Count views by path.",
  isRanked: true,
  totals: pageviewTotals,
  countsVisitors: true,
  description: `\
Counts the pages people looked at, most looked at first.

A pageview is a GET that answered with HTML and succeeded, which is what
separates a page from the images, stylesheets and fonts the same log records.
\`sc-content-type\` is delivered for exactly this, since a path alone cannot
always tell one from the other. A 304 counts, because a browser being told
its copy is current is somebody looking at the page.

The path is decoded, so an address holding characters outside ASCII reads as
itself. CloudFront writes one percent-encoded twice.`,
  body: (request) =>
    [
      `SELECT ${decodedColumn("cs_uri_stem")} AS path, count(*) AS views`,
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, aPageView),
      "  GROUP BY 1",
      rankedOrder,
      limitOf(request),
    ].join("\n"),
};

/** Where people arrived from, excluding the site itself. */
export const referrers: Rollup = {
  name: "referrers",
  summary: "Count views by where they came from.",
  isRanked: true,
  totals: referrerTotals,
  description: `\
Counts where people arrived from, by the host that sent them.

Only the host, since a full referring URL splits one source across dozens of
rows. Requests carrying no referrer are left out, and so are the ones a page
on this site sent, which are somebody moving around rather than arriving. On
the reference site an unfiltered version of this is topped by its own
stylesheet.

This is the only account of how anybody arrived that a server-side log can
give, and browsers give less of it every year.`,
  body: (request) =>
    [
      "SELECT url_extract_host(cs_referer) AS referrer, count(*) AS views",
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, [
        ...aPageView,
        `cs_referer <> ${empty}`,
        "url_extract_host(cs_referer) <> x_host_header",
      ]),
      "  GROUP BY 1",
      rankedOrder,
      limitOf(request),
    ].join("\n"),
};

/** Pageviews by browser family and coarse device class. */
export const browsers: Rollup = {
  name: "browsers",
  summary: "Count views by browser and device class.",
  isRanked: true,
  totals: browserTotals,
  description: `\
Counts pageviews by browser family and device class, most viewed first.

A pageview is the same successful HTML GET that \`pageviews\` counts. Assets do
not multiply a browser's number by however many files its page loaded.

The browser families are Edge, Opera, Samsung Internet, Firefox, Chrome
family, Safari family and Other. The fixed SQL ladder checks the specific
browsers before the Chrome and Safari compatibility tokens their user agents
also carry. A new browser either joins the family it presents as or stays
under Other until the ladder changes. No historical row is rewritten.

Device class is Tablet, Mobile, Desktop or Other. Explicit tablet tokens come
first, then mobile tokens. An Android agent without Mobile counts as a tablet.
Desktop covers the common Windows, macOS, ChromeOS and Linux tokens.

A user agent is a claim made by the client. Chromium derivatives can present
as Chrome, and iPadOS can present as macOS. Embedded browsers, televisions and
agents with reduced or unusual strings can land under another class or Other.
The rollup reports no browser version and cannot recover distinctions absent
from the raw user agent.`,
  body: (request) =>
    [
      `SELECT ${browserFamily} AS browser,`,
      `  ${deviceClass} AS device,`,
      "  count(*) AS views",
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, aPageView),
      "  GROUP BY 1, 2",
      "  ORDER BY 3 DESC, 1, 2",
      limitOf(request),
    ].join("\n"),
};

/** What CloudFront answered with, most answered first. */
export const statusCodes: Rollup = {
  name: "status-codes",
  summary: "Count responses by status code.",
  isRanked: true,
  totals: statusTotals,
  description: `\
Counts what CloudFront answered with.

Every response, rather than the HTML subset the pageview count uses. A
stylesheet returning 404 is worth seeing, and it is invisible in a rollup
that only looks at pages.

Automated traffic is left out by default here as it is everywhere else. Bots
find the broken links first and in numbers, so \`--include-bots\` is usually
what you want when reading this one.

Requests to the beacon's own path (\`${defaultBeaconPath}\`) are left out too,
and no option puts them back. The beacon writes one row per event, and a
single-page app sends several per reader per page. Those 204s can outnumber
every response the site itself served, and they carry one status between
them. The 404 this rollup exists to surface then sits somewhere below them.

The beacon is Rainlytics measuring the site, and what the site answered is
the question here. \`rainlytics query\` counts the beacon's own rows for
anybody checking that it is delivering.`,
  body: (request) =>
    [
      "SELECT sc_status AS status, count(*) AS responses",
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, [outsideTheBeaconPath]),
      "  GROUP BY 1",
      rankedOrder,
      limitOf(request),
    ].join("\n"),
};

/** How much of the traffic CloudFront served without reaching the origin. */
export const cacheHitRatio: Rollup = {
  name: "cache-hit-ratio",
  summary: "Show how much CloudFront served from cache.",
  isRanked: false,
  totals: cacheTotals,
  description: `\
Shows how much CloudFront served from its own cache.

Counted over the values that say whether the cache served the request,
being a Hit, a RefreshHit and a Miss. Every other value is left out.

A redirect and the \`FunctionGeneratedResponse\` a beacon event comes back
as never reached the cache, so counting them would move the ratio without
anything about the cache having changed. An \`Error\` is left out for a
different reason: it says too little. CloudFront caches error responses,
and \`Error\` also covers a viewer who disconnected after being served one.

One row, so \`--limit\` does nothing here.`,
  body: (request) =>
    [
      "SELECT",
      `  ${counted(cacheHit)} AS hits,`,
      `  ${counted("x_edge_result_type = 'Miss'")} AS misses,`,
      `  round(100.0 * ${counted(cacheHit)}` +
        ` / nullif(${counted(cacheDecided)}, 0), 1) AS hit_percent`,
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request),
    ].join("\n"),
};

/** The term one record carries, for the parameter a request named. */
const searchTerm = (request: RollupRequest): string =>
  decodedParameter(request.param);

/** The lines a search rollup varies with the pages it was asked about. */
interface SearchShape {
  /** The column naming the page a row came from, where there is one. */
  readonly section: readonly string[];

  /** What the answer is grouped by and ordered on. */
  readonly order: readonly string[];
}

/**
 * What a search rollup selects and groups by, given the pages it covers.
 *
 * Several pages get a column naming the one each row came from, and the count
 * is then per term per page. One page has one answer, and a column repeating
 * it down the table tells the reader what they typed. The ordinals move along
 * by the column in front of them.
 *
 * {@link matchedPath} writes that column out of the same prefix tests the
 * filter under it is built from. A copy of the expression here would be a
 * second statement of what a prefix match is, and the drift shows up as a
 * column disagreeing with the rows beside it.
 */
const searchShape = (request: RollupRequest): SearchShape =>
  (request.paths ?? []).length > 1
    ? {
        section: [`  ${matchedPath(request)} AS section,`],
        order: ["  GROUP BY 1, 2", "  ORDER BY 3 DESC, 1, 2"],
      }
    : { section: [], order: ["  GROUP BY 1", rankedOrder] };

/** What people typed into a search box, most typed first. */
export const searches: Rollup = {
  name: "searches",
  summary: "Count searches by the term somebody typed.",
  isRanked: true,
  totals: searchTotals,
  namesAParameter: true,
  countsRedirects: true,
  description: `\
Counts what people typed into a search box, most typed first.

The terms are already in the access log. CloudFront records \`cs-uri-query\`
whatever the cache key and origin forwarding are set to, so a search answered
from the edge is counted alongside one that reached the origin. No other
source covers both.

Name the search page with \`--path\`, since a site's other query strings are
in the same log. \`--param\` names the parameter carrying the term, and
defaults to \`q\`.

\`redirected\` counts the searches answered with 302, 303 or 307. A site
that sends an exact match straight to its page can read that as the searches
that found one, against the searches that only produced a list.

301 and 308 are left out, and \`--redirect-status\` names your own. A
permanent redirect is address tidying. A reader gets one whatever they
typed, and counting a trailing-slash 308 reports that reader as two searches
and calls the first of them a term the site publishes a page for.

Give \`--path\` twice and every row names its own page in a \`section\`
column. Two search boxes are then one answer that says which box each term
was typed into. One \`--path\` leaves the column out, since every row would
carry the same value.`,
  body: (request) => {
    const shape = searchShape(request);

    return [
      `SELECT ${searchTerm(request)} AS term,`,
      ...shape.section,
      "  count(*) AS searches,",
      `  ${counted(aRedirect(request))} AS redirected`,
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, [
        "cs_method = 'GET'",
        `cs_uri_query <> ${empty}`,
        `${searchTerm(request)} <> ''`,
      ]),
      ...shape.order,
      limitOf(request),
    ].join("\n");
  },
};

/** Every question the command line answers without any SQL. */
export const rollups: readonly Rollup[] = [
  pageviews,
  referrers,
  browsers,
  statusCodes,
  cacheHitRatio,
  searches,
];
