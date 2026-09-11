// What proportion of the people who looked at a site did the thing, measured
// off the access log alone.
//
// `conversionsOf` in `conversion-rollup.ts` counts a beacon event, and a
// server-rendered site has no beacon to raise one. Adding to a basket is a
// `POST /do/basket/add`, checking out is a `POST /do/checkout`, and the order
// page is a `GET`. CloudFront logged all three, so the question Rainlytics
// exists to answer without JavaScript was the one it could not answer without
// JavaScript. KensioSoftware/rainlytics#171 closed that.
//
// **This is a factory rather than a rollup**, for the reason `conversionsOf`
// is. A site converting at the checkout and at the signup form is asking two
// questions, and two questions want two names, two saved queries and two
// summary keys.
//
// Only the row predicate differs between the two. The pageview half, the
// visitor pair and the single pass are in `conversion-query.ts`.

import {
  all,
  conversionQuery,
  countingConvertedVisitors,
} from "./conversion-query.js";
import { startingWithPath } from "./rollup-rows.js";
import type { Rollup } from "./rollups.js";
import { assertRollupName } from "./rollups.js";
import { oneOf, quoted } from "./sql-text.js";

/** Which requests a site counts as somebody converting. */
export interface ConvertingRequest {
  /**
   * The path a converting request starts with.
   *
   * A prefix, matched against the decoded path the way `--path` is, so it
   * names the address a reader sees rather than the escapes the record holds.
   */
  readonly path: string;

  /**
   * The method that counts, where only one does.
   *
   * A checkout is a `POST` and the page confirming it is a `GET`, and the two
   * are different questions about the same path. Absent counts either.
   */
  readonly method?: string | undefined;

  /**
   * The response statuses that count as a conversion.
   *
   * A refused post is not a conversion. A checkout that answered 400 is
   * somebody who tried, and a question counting it reports a conversion rate
   * the site never had. Absent counts whatever the site answered.
   */
  readonly statuses?: readonly string[] | undefined;

  /**
   * What the question is called, after `conversions-`.
   *
   * Taken from the path where nobody says. `/do/checkout` becomes
   * `conversions-do-checkout`. Name it where the path makes a poor one, or
   * where two paths would reduce to the same words.
   */
  readonly name?: string | undefined;
}

/**
 * A row that is one of the requests counted as a conversion.
 *
 * The path test is the one `rowsFor` writes for `--path`, taken from there
 * rather than written again. A numerator matching rows on different terms
 * from the denominator is the way this question would go quietly wrong.
 */
const aConversion = (converting: ConvertingRequest): string =>
  all([
    startingWithPath(converting.path),
    ...(converting.method === undefined
      ? []
      : [`cs_method = ${quoted(converting.method.toUpperCase())}`]),
    ...(converting.statuses === undefined
      ? []
      : [oneOf("sc_status", converting.statuses)]),
  ]);

/**
 * The path as a rollup name, being its segments joined by hyphens.
 *
 * Lowercased, with every run of anything else becoming one hyphen.
 * `/do/checkout` is `do-checkout` and `/Sign Up/` is `sign-up`.
 *
 * @throws {Error} where nothing survives, which is what `/` and a path of
 *   punctuation both come to. `name` is the way past that.
 */
function nameOf(converting: ConvertingRequest): string {
  const derived = converting.path
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

  if (derived === "") {
    throw new Error(
      `The path "${converting.path}" gives no rollup name. Pass "name" to` +
        ` say what the question is called.`,
    );
  }

  return derived;
}

/**
 * The question of how many of a window's visitors made one kind of request.
 *
 * ```typescript
 * new RollupSummaries(this, "Summaries", {
 *   table,
 *   workgroup,
 *   rollups: [
 *     ...rollups,
 *     conversionsOfPath({
 *       path: "/do/checkout",
 *       method: "POST",
 *       statuses: ["303"],
 *     }),
 *   ],
 * });
 * ```
 *
 * The same question {@link conversionsOf} asks, off rows CloudFront already
 * logged. A site with no beacon, and therefore no JavaScript to raise an
 * event, converts on a URL, and this is the half of the pipeline that was
 * always going to see it.
 *
 * The denominator is every visitor the window saw, being the same rows and
 * the same definition `visitor-counts.ts` counts over. The numerator is the
 * visitors among them who also made a request matching `converting`. A
 * visitor who made one without looking at a page in the same window counts in
 * neither, which is what keeps the proportion at or below one.
 *
 * A reader who looks at 09:59 and checks out at 10:01 is one visitor split
 * across two hourly windows, and neither window sees both halves. The answer
 * is honest at a day and noisy at an hour, the way {@link conversionsOf} is.
 *
 * @throws {Error} where the name would be one no subcommand and no CDK
 *   logical id could carry.
 */
export function conversionsOfPath(converting: ConvertingRequest): Rollup {
  const name = `conversions-${converting.name ?? nameOf(converting)}`;
  assertRollupName(name);

  const described = [
    converting.method === undefined
      ? `a request to \`${converting.path}\``
      : `a \`${converting.method.toUpperCase()}\` to \`${converting.path}\``,
    ...(converting.statuses === undefined
      ? []
      : [`answered ${converting.statuses.join(" or ")}`]),
  ].join(" ");

  return {
    name,
    summary: `Show how many visitors made ${described}.`,
    isRanked: false,
    identifiesViewers: true,
    description: `\
Shows how many of the window's visitors made ${described}, against how many
were seen at all. It reads the access log alone and needs no beacon.

\`visitors\` counts everybody who looked at a page, which is the same rows the
visitor count beside \`pageviews\` is taken over. \`converted\` counts the ones
who also made that request. Somebody who made it without looking at a page in
the same window counts in neither, which is what holds the proportion at or
below one.

The path is a prefix, matched against the decoded path the way \`--path\` is.
${
  converting.statuses === undefined
    ? `Every response counts, whatever the site answered. Name the statuses
under \`statuses\` where a refused request should not, since somebody who
tried is not somebody who converted.`
    : `A response outside ${converting.statuses.join(" and ")} counts as
somebody who tried rather than somebody who converted.`
}

${countingConvertedVisitors}`,
    body: (request) => conversionQuery(request, aConversion(converting)),
  };
}
