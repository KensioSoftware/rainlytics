// The span of time one rollup summary covers, and the two renderings of it.
//
// Apart from the document in `rollup-summaries.ts` because a window is
// addressed before there is a summary to put in it. A job asks which window
// it is computing, a reader asks which window it wants, and the key and the
// document both come from the answer.
//
// Every window is UTC. The partitions underneath are UTC, and one person's
// local day stored on S3 is the wrong day for the next person to ask. The
// conversion to somebody's own day happens in the reader, at the moment an
// answer is printed. `docs/summaries/` has the reasoning and what it costs.

/**
 * How long the window one summary covers is.
 *
 * The same two words as the partition granularity in `partition-keys.ts`,
 * and a type of its own. The two decide different things. A dataset
 * partitioned by hour can carry daily summaries, and one partitioned by day
 * can carry hourly ones at the price of rereading a day for each of them.
 */
export type SummaryGranularity = "hourly" | "daily";

/**
 * The windows Rainlytics stores, shortest first.
 *
 * Hours and days, and each of them computed from raw. An hour is what a
 * reader wants when the question is about this morning, and it is the unit a
 * local day is put together from. A day is what most questions are actually
 * about, and it holds a month of pageviews to thirty GETs where hours would
 * take seven hundred and twenty.
 *
 * Nothing coarser. A stored week or month is a number a reader cannot check
 * against the days inside it, and a visitor count has no meaning over a span
 * longer than one day (`VisitorCount` in `rollup-summaries.ts` has why). Every
 * window stored here is one that every measure in a summary is true over.
 *
 * The cost is one query per window per question. Athena bills a ten million
 * byte minimum whatever a query reads, and 25 queries a day comes to about
 * four cents a month for one question and 9,125 objects a year.
 */
export const summaryGranularities: readonly SummaryGranularity[] = [
  "hourly",
  "daily",
];

/**
 * The window a summary covers, as a caller addresses it.
 *
 * `at` is any instant inside the window, and both renderings below truncate
 * it. `partitionPrefix` addresses a partition the same way. A job computing
 * the hour that has just closed hands over any time inside it and never
 * works out where the hour began.
 */
export interface SummaryWindow {
  /** How long the window is. */
  readonly granularity: SummaryGranularity;

  /** An instant inside the window being addressed. */
  readonly at: Date;
}

/**
 * The exact span one window covers, as the document records it.
 *
 * Both ends written out, in UTC and in ISO 8601. `from` is inside the window
 * and `until` is outside it. Midnight then belongs to the day it opens and
 * to no other, and no reader derives that from the granularity.
 */
export interface SummarySpan {
  /** How long the window is. */
  readonly granularity: SummaryGranularity;

  /** The first instant in the window. */
  readonly from: string;

  /** The first instant after it. */
  readonly until: string;
}

/** How long each window is, in milliseconds. */
const windowMilliseconds: Readonly<Record<SummaryGranularity, number>> = {
  hourly: 3_600_000,
  daily: 86_400_000,
};

/**
 * The span an addressed window covers.
 *
 * The instant is truncated to the start of its hour or its day in UTC, and
 * the end is one window on from there. A UTC day is 86,400,000 milliseconds
 * every day of the year. The clocks a reader lives under change and UTC does
 * not, and that is the second reason every stored window is UTC.
 *
 * Both renderings of a window come through here, this one and the key, so
 * the document and the object holding it cannot disagree about which hour a
 * summary is for.
 *
 * @throws {RangeError} for an invalid Date, rather than a span reading
 *   "Invalid Date" that every later comparison quietly fails.
 */
export function summarySpan(window: SummaryWindow): SummarySpan {
  const from = startOf(window);

  return {
    granularity: window.granularity,
    from: from.toISOString(),
    until: new Date(
      from.getTime() + windowMilliseconds[window.granularity],
    ).toISOString(),
  };
}

/** The first instant in the window holding an instant. */
function startOf(window: SummaryWindow): Date {
  const { at } = window;

  if (Number.isNaN(at.getTime())) {
    throw new RangeError(
      "Cannot address a summary window for an invalid Date.",
    );
  }

  return new Date(
    Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
      window.granularity === "hourly" ? at.getUTCHours() : 0,
    ),
  );
}
