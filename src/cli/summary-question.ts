// Whether a stored summary answers the question somebody typed.
//
// This is the hard part of reading summaries. `--path`, `--host`,
// `--include-bots` and `--param` each change the answer, and a schedule
// computes the questions its deployment named. Rainlytics precomputes the
// unfiltered form, and a site adds a narrowed one through the `requests` prop
// on `RollupSummaries`.
//
// `SummaryQuestion` is what a summary records about itself, and it is defined
// as `RollupRequest` minus the range and the dataset. A filter added to the
// commands therefore arrives here on its own, and a comparison written out
// field by field would go on comparing the fields a rollup used to have.

import type { SummaryQuestion } from "../rollup-summaries.js";
import type { Rollup, RollupRequest } from "../rollups.js";

/**
 * The options that narrow a question, spelled as a reader types them.
 *
 * The list every reader of a narrowing walks. `questionDifferences` compares
 * these fields, `summary-adoption.ts` takes the ones a command line left out,
 * and `rollup-options.ts` records which of them arrived. An option added to a
 * rollup command reaches all three from here.
 *
 * `--last` is left out. The window is the range a summary answers over, and a
 * span is what a reader is choosing when they type it.
 */
export const narrowingOptions = [
  "--host",
  "--path",
  "--include-bots",
  "--param",
  "--redirect-status",
  "--limit",
] as const;

/** One option that narrows a question. */
export type NarrowingOption = (typeof narrowingOptions)[number];

/** One way a stored summary answers something else. */
export interface QuestionDifference {
  /** The option a reader would change, as they would type it. */
  readonly option: NarrowingOption;

  /** What this run asked for. */
  readonly asked: string;

  /** What the schedule computed. */
  readonly computed: string;
}

/** One filter the stored summaries of a span were not all computed with. */
export interface StoredDisagreement {
  /** The option that would settle it. */
  readonly option: NarrowingOption;

  /** The values found among the summaries, as a sentence names them. */
  readonly computed: readonly string[];
}

/** The question one command line asks, as a summary would record it. */
export function askedQuestion(
  rollup: Rollup,
  request: RollupRequest,
): SummaryQuestion {
  const { dataset: _dataset, range: _range, ...question } = request;

  return { name: rollup.name, ...question };
}

/**
 * Where a stored summary answers a different question from the one asked.
 *
 * An empty list means the summary covers this run. Anything else names the
 * options a reader would have to change, and whatever reports it offers the
 * query that answers the question as asked.
 *
 * `--limit` is the one field where the two need only overlap. A summary
 * computed with the top hundred paths holds the top twenty inside it, and
 * cutting a stored answer down is the same arithmetic the query does. The
 * reverse loses rows nobody counted.
 *
 * Three fields are compared only for the questions that read them.
 * `rollupRequest` fills in a default for every field of every question, so a
 * deployment that set one on a rollup ignoring it changed no answer.
 * `--param` belongs to a question about what somebody typed,
 * `--redirect-status` to the one separating a search sent to its answer from
 * one that produced a list, and `--limit` to a question answering with a
 * ranked list. `cache-hit-ratio` answers with one row and has nothing to
 * limit, which is why its command takes no `--limit` either.
 */
export function questionDifferences(
  rollup: Rollup,
  asked: SummaryQuestion,
  computed: SummaryQuestion,
): readonly QuestionDifference[] {
  const differences: QuestionDifference[] = [
    ...differing("--host", hostText(asked.host), hostText(computed.host)),
    ...differing("--path", pathText(asked.paths), pathText(computed.paths)),
    ...differing(
      "--include-bots",
      botText(asked.includeBots),
      botText(computed.includeBots),
    ),
    ...(rollup.namesAParameter === true
      ? differing("--param", asked.param, computed.param)
      : []),
    ...(rollup.countsRedirects === true
      ? differing(
          "--redirect-status",
          asked.redirectStatuses.join(","),
          computed.redirectStatuses.join(","),
        )
      : []),
  ];

  return !rollup.isRanked || computed.limit >= asked.limit
    ? differences
    : [
        ...differences,
        {
          option: "--limit",
          asked: `${String(asked.limit)} rows`,
          computed: `${String(computed.limit)} rows`,
        },
      ];
}

/** The difference between two values, where there is one. */
function differing(
  option: NarrowingOption,
  asked: string,
  computed: string,
): readonly QuestionDifference[] {
  return asked === computed ? [] : [{ option, asked, computed }];
}

/** The host a question counted, as a sentence names it. */
function hostText(host: string | undefined): string {
  return host ?? "every host";
}

/** The sections a question counted, as a sentence names them. */
function pathText(paths: readonly string[] | undefined): string {
  const named = paths ?? [];

  return named.length === 0 ? "the whole distribution" : named.join(" ");
}

/** Whether a question counted automated traffic, as a sentence says it. */
function botText(includeBots: boolean): string {
  return includeBots ? "crawlers counted" : "crawlers left out";
}
