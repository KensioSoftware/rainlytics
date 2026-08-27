// What one precomputed answer holds, and where it lands on S3.
//
// Two halves have to agree about this and they run a long way apart. A
// scheduled job writes a summary and a command reads it back, and the command
// reading it may have been released a year after the job that wrote it. The
// disagreement is the quiet kind. A job writing under a key nothing fetches
// looks healthy from where it stands, and a reader parsing fields that have
// moved prints an answer with columns missing.
//
// So both halves read this, the way both halves of the dataset read
// `dataset.ts` and both halves of the layout read `partitions.ts`.
//
// The window a summary covers is in `summary-windows.ts`, with the reason
// every stored window is UTC.
//
// Nothing here computes, writes, schedules or fetches a summary.
// KensioSoftware/rainlytics#55 does the first three and #56 the last.

import { assertRollupName, type RollupRequest } from "./rollups.js";
import {
  type SummarySpan,
  summarySpan,
  type SummaryWindow,
} from "./summary-windows.js";

/**
 * Which shape a summary document is, carried in its key and in the document.
 *
 * A summary written today is read by a command released next year. The
 * version is in the key so that an old command asks for the shape it can
 * read and gets a 404 where nothing wrote one. A 404 is a case every reader
 * has already had to write. A document it cannot parse is not.
 *
 * It is in the document as well, because an object separated from its key
 * still has to say what it is. A summary downloaded, piped through `jq` or
 * copied into a bucket of somebody's own carries no prefix with it.
 *
 * It changes when a field changes meaning or leaves. A field added and left
 * optional does not change it. A reader that has never heard of that field
 * ignores it, and one that has can tell absent from present. The visitor
 * count arriving with KensioSoftware/rainlytics#74 is exactly that case, and
 * it is why {@link RollupSummary.visitors} is optional today.
 */
export const summarySchemaVersion = 1;

/**
 * The question one summary answers, being a rollup's name and the narrowing
 * it ran under.
 *
 * Taken from `RollupRequest` and not written out again. A field there is a
 * field that changes an answer. A hand-copied list of them would go on
 * describing the answer a rollup used to give, and the copy that drifts is
 * always the one nothing deploys.
 *
 * The range is left out because the window is the range. The dataset is left
 * out because every summary in one bucket came from the same table.
 *
 * A reader compares this against what somebody asked for. Where the two
 * differ the summary answers a different question, and
 * KensioSoftware/rainlytics#56 decides what a command does about that.
 */
export type SummaryQuestion = Omit<RollupRequest, "dataset" | "range"> & {
  /** The rollup that produced the rows, as in `rainlytics pageviews`. */
  readonly name: string;
};

/**
 * One value in one row.
 *
 * Text or nothing. Every column in the log table is text and Athena hands
 * every value back as text. `null` is what JSON has where the SDK has
 * `undefined`, and it is what a document holds after a round trip through
 * `JSON.parse`.
 */
export type SummaryCell = string | null;

/** One row of an answer, addressed by column name. */
export type SummaryRow = Readonly<Record<string, SummaryCell>>;

/**
 * How many visitors one window saw.
 *
 * An object holding a number, and the number is why. Rainlytics identifies a
 * visitor by a hash that takes a new salt every day
 * (KensioSoftware/rainlytics#53). One person carries one identifier today and
 * a different one tomorrow. A day of them counts. Two days added together
 * count everybody who came back twice over, and a month of them is a figure
 * about nothing.
 *
 * Thirty summaries each carrying `visitors: 429` are thirty numbers a reader
 * adds up in one line, and nothing in the document would have said the line
 * was wrong. The wrapper is what stops that line compiling, and `additive` is
 * what says the same thing to somebody reading the JSON with `jq`.
 *
 * A month of visitors is a question for a query over raw, and even then only
 * where a salt older than a day can be reached.
 */
export interface VisitorCount {
  /** Distinct visitor identifiers seen inside this window. */
  readonly distinct: number;

  /** Always false. Two windows' counts do not add. */
  readonly additive: false;
}

/** One question, answered over one window, as it lands on S3. */
export interface RollupSummary {
  /**
   * Which shape this document is, being {@link summarySchemaVersion} when it
   * was written.
   *
   * A number and not the literal. A reader meets documents this package did
   * not write, and needs somewhere to put the version it found before it
   * decides whether it can read the rest.
   */
  readonly schemaVersion: number;

  /** The question these rows answer. */
  readonly question: SummaryQuestion;

  /** The span they cover. */
  readonly window: SummarySpan;

  /**
   * When the job ran, in ISO 8601 and UTC.
   *
   * Text and not a `Date`. This describes a JSON document, and `JSON.parse`
   * hands text back. A field typed `Date` would be a string at run time in
   * every reader that forgot to revive it, and the type would say otherwise
   * the whole way.
   *
   * A reader tells somebody how old an answer is from this and the window
   * together. A summary of yesterday computed twice says so.
   */
  readonly computedAt: string;

  /**
   * The column names, in the order they are written.
   *
   * Stated here so that a summary finding nothing still names its columns.
   * Reading them off the rows would leave an empty answer with no header,
   * and an empty CSV still needs one.
   */
  readonly columns: readonly string[];

  /**
   * The answer, as the query returned it.
   *
   * Never added to another window's rows. A ranked question answers with its
   * top rows, and the top twenty paths of two hours are not the top twenty
   * paths of the two hours together. A path ranked twenty-first in every hour
   * of a day can outrank one that led a single hour. A longer window is its
   * own query over raw.
   */
  readonly rows: readonly SummaryRow[];

  /**
   * How many visitors the window saw, where the question counted them.
   *
   * Absent until KensioSoftware/rainlytics#74 computes an identifier, and
   * absent from every question that counts something else.
   * `{ distinct: 0, additive: false }` is a different answer, being a window
   * that nobody visited.
   */
  readonly visitors?: VisitorCount | undefined;
}

/**
 * What a window nobody has computed comes back as.
 *
 * A reader fetching one meets three answers and they mean different things. A
 * document carrying rows is the answer. A document carrying none is a window
 * that saw no traffic, and a job writes one whenever a query comes back
 * empty. No object at all is this. Nobody has computed the window, and the
 * reader has learned nothing about the traffic in it.
 *
 * That first distinction is a requirement on the job. A run that skipped
 * writing an empty answer would leave "no traffic" and "never ran" as the
 * same 404.
 *
 * A sentence and not `undefined`, for the reason `currentMonth` is one. A
 * command printing what it found says "never computed".
 */
export const neverComputed = "never computed";

/** What a lookup for one window comes to. */
export type SummaryLookup = RollupSummary | typeof neverComputed;

/**
 * Where one summary lives, as a key relative to the bucket holding them.
 *
 * ```text
 * summaries/v1/pageviews/daily/2026-08-27.json
 * summaries/v1/pageviews/hourly/2026-08-27T14Z.json
 * ```
 *
 * Derived from the question and the window and from nothing else. A job
 * re-run writes the same key and overwrites what was there. A bug in a rollup
 * is then a re-run and never an incident, and a window recomputed for the
 * records that arrived late replaces the answer that missed them.
 *
 * Only the question's name reaches the key. Two narrowings of one question
 * are two questions and take two names, the way `RollupQueries` saves one
 * named query per rollup name and a site writing its own question gives it
 * one. The narrowing is recorded in the document, and a reader that asked for
 * something else can see that it did.
 *
 * Keys sort into time order under one prefix. A reader listing
 * `summaries/v1/pageviews/daily/` finds the newest last, and a version this
 * package has never heard of is a prefix it never lists.
 *
 * Nothing parses a key. The dates in it are UTC and the document carries the
 * span in full.
 *
 * @throws {Error} for a name no rollup can carry.
 * @throws {RangeError} for an invalid Date.
 */
export function summaryKey(
  question: SummaryQuestion,
  window: SummaryWindow,
): string {
  assertRollupName(question.name);

  const span = summarySpan(window);

  return [
    "summaries",
    `v${String(summarySchemaVersion)}`,
    question.name,
    window.granularity,
    `${windowText(span)}.json`,
  ].join("/");
}

/** The window as a key names it, being the day or the hour it opens. */
function windowText(span: SummarySpan): string {
  return span.granularity === "daily"
    ? span.from.slice(0, 10)
    : `${span.from.slice(0, 13)}Z`;
}
