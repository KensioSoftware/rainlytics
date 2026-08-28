// What a command read, how old it is and what that cost, said on standard
// error.
//
// The same slot `query-report.ts` fills for a query, and the same reason.
// Whoever just asked a question should see what answered it, and a person
// comparing this figure against something else has to know how far behind the
// scheduled run it is.
//
// Standard error, so a pipeline reads rows and never prose.

import type { RollupSummary } from "../rollup-summaries.js";
import { inDollars } from "./query-report.js";
import {
  count,
  getChargeInDollars,
  howLongBefore,
  newestComputedAt,
  spanOf,
} from "./summary-freshness.js";

/** What one command read out of the bucket. */
export interface SummaryRead {
  /** The bucket the summaries came from. */
  readonly bucket: string;

  /** The question, as a subcommand names it. */
  readonly name: string;

  /** The summaries that answered, oldest window first. */
  readonly summaries: readonly RollupSummary[];

  /** How many windows in the range asked for had no summary. */
  readonly missing: number;

  /** How many objects were asked for, which is what the read cost. */
  readonly gets: number;

  /** The filters this run took from the summaries rather than the line. */
  readonly adopted: readonly string[];

  /** Whether the question answers with a ranked list. */
  readonly isRanked: boolean;

  /** When the command ran, for the age of the newest summary. */
  readonly at: Date;
}

/**
 * What was read and how old it is, for standard error.
 *
 * The span comes from the windows rather than from what was asked for. A
 * reader asking about seven days is answered over the windows that exist, and
 * the difference between those two is the thing worth printing.
 */
export function summaryReport(read: SummaryRead): string {
  return [
    coverageLine(read),
    ...adoptedLines(read),
    freshnessLine(read),
    ...missingLines(read),
    ...rankingLines(read),
    ...visitorLines(read),
  ].join("\n");
}

/** How many summaries answered, and the span they cover. */
function coverageLine(read: SummaryRead): string {
  const span = spanOf(read.summaries);

  return (
    `Read ${count(read.summaries.length, "summary", "summaries")} of` +
    ` ${read.name} from ${read.bucket}, covering ${span.from} to` +
    ` ${span.until}.\n`
  );
}

/**
 * The filters this run took from the summaries.
 *
 * Part of what answered rather than a report of its own, and this is the
 * paragraph saying which question the rows below belong to. A reader who typed
 * four words and got an answer about one section of their site has to be able
 * to see where that section came from, and the line is what they copy onto the
 * command line to ask a narrower question of the same summaries.
 *
 * Printed on the runs that answered. A run refused for a filter somebody typed
 * needs the refusal and not a paragraph about the filters it would have taken.
 */
function adoptedLines(read: SummaryRead): readonly string[] {
  if (read.adopted.length === 0) {
    return [];
  }

  return [
    `Took ${read.adopted.join(" ")} from the summaries. Those options were` +
      ` left off this command line, and the answer covers the narrowing the` +
      ` deployment computes.\n`,
  ];
}

/** How old the newest of them is, and what the whole read cost. */
function freshnessLine(read: SummaryRead): string {
  const newest = newestComputedAt(read.summaries);

  return (
    `The newest was computed ${newest} (${howLongBefore(newest, read.at)}` +
    ` ago). ${count(read.gets, "GET", "GETs")}, about` +
    ` ${inDollars(getChargeInDollars(read.gets))} at the us-east-1 rate.\n`
  );
}

/** The windows in the range that nothing has computed. */
function missingLines(read: SummaryRead): readonly string[] {
  if (read.missing === 0) {
    return [];
  }

  return [
    `${count(read.missing, "window", "windows")} in the range asked for` +
      ` ${read.missing === 1 ? "has" : "have"} no summary yet. Answering` +
      ` over those is --query, at the cost a query reports.\n`,
  ];
}

/** What a ranked answer assembled from several windows leaves out. */
function rankingLines(read: SummaryRead): readonly string[] {
  if (!read.isRanked || read.summaries.length < 2) {
    return [];
  }

  return [
    `Assembled from ${String(read.summaries.length)} windows, and the` +
      ` ranking is approximate. A row that fell outside the stored rows of` +
      ` every window is missing from all of them. --query ranks the whole` +
      ` span in one pass.\n`,
  ];
}

/**
 * What the answer says about visitors.
 *
 * One window carries a count somebody can use. Several carry one each, and
 * adding them counts everybody who came back twice over. `VisitorCount` in
 * `rollup-summaries.ts` has the salt that makes that true.
 */
function visitorLines(read: SummaryRead): readonly string[] {
  const counted = read.summaries.filter(
    (summary) => summary.visitors !== undefined,
  );
  const [only] = counted;

  if (only?.visitors === undefined) {
    return [];
  }

  return counted.length === 1
    ? [`${String(only.visitors.distinct)} visitors in that window.\n`]
    : [
        `Visitors are counted per window and do not add, so this range has no` +
          ` visitor count. A visitor carries a new identifier every day.\n`,
      ];
}
