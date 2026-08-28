// How old an answer is, what reading it cost, and the words for both.
//
// Apart from `summary-report.ts`, which assembles the lines a command writes.
// This is the arithmetic under them, the way `athena-pricing.ts` sits under
// the scan report.

import type { RollupSummary } from "../rollup-summaries.js";

/**
 * What S3 charges for a GET, per thousand.
 *
 * $0.0004 in us-east-1 for S3 Standard, from
 * [S3 pricing](https://aws.amazon.com/s3/pricing/) read on 2026-08-28. Other
 * regions and other storage classes differ, and whatever quotes this says
 * which rate it used.
 *
 * This is the figure the project is organised around. A week of pageviews is
 * 29 objects and about a hundredth of a cent, against the ten million byte
 * minimum Athena bills for a single query.
 */
const dollarsPerThousandGets = 0.0004;

/** What reading a pile of summaries cost, in dollars, at that rate. */
export function getChargeInDollars(gets: number): number {
  return (gets / 1000) * dollarsPerThousandGets;
}

/**
 * The newest instant any of these summaries was computed at.
 *
 * Compared as text. Every instant in a document is ISO 8601 in UTC, and that
 * spelling sorts into time order.
 */
export function newestComputedAt(summaries: readonly RollupSummary[]): string {
  let newest = "";

  for (const summary of summaries) {
    if (summary.computedAt > newest) {
      newest = summary.computedAt;
    }
  }

  return newest;
}

/**
 * The whole span a pile of summaries covers.
 *
 * Folded over the list rather than read off its two ends, so a pile in any
 * order answers the same. The windows arrive oldest first and the fold says
 * that without relying on it.
 */
export function spanOf(summaries: readonly RollupSummary[]): {
  readonly from: string;
  readonly until: string;
} {
  let from = "";
  let until = "";

  for (const summary of summaries) {
    from =
      from === "" || summary.window.from < from ? summary.window.from : from;
    until = summary.window.until > until ? summary.window.until : until;
  }

  return { from, until };
}

/**
 * How long before an instant another one was, as a person reads it.
 *
 * Minutes up to an hour and a half, then hours, then days. A reader comparing
 * a summary against something else wants the order of magnitude, and a lag
 * measured in minutes is the one the schedule is built around.
 */
export function howLongBefore(computedAt: string, at: Date): string {
  const minutes = Math.max(
    0,
    Math.round((at.getTime() - Date.parse(computedAt)) / 60_000),
  );

  if (minutes < 90) {
    return count(minutes, "minute", "minutes");
  }

  const hours = Math.round(minutes / 60);

  return hours < 36
    ? count(hours, "hour", "hours")
    : count(Math.round(hours / 24), "day", "days");
}

/** A count and the word for it, singular where there is one. */
export function count(many: number, one: string, several: string): string {
  return `${String(many)} ${many === 1 ? one : several}`;
}
