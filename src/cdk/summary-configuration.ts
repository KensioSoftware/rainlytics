// What a deployment of the scheduled summaries was told, checked and filled
// in.
//
// Apart from the construct because they are different jobs. This decides what
// the deployment computes, and the construct builds the bucket, the function
// and the schedules that compute it.

import type { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Duration } from "aws-cdk-lib/core";

import type { Rollup } from "../rollups.js";
import { rollups } from "../rollup-questions.js";
import { defaultRecomputedWindows } from "../summary-runs.js";
import type { SummaryGranularity } from "../summary-windows.js";
import { summaryGranularities } from "../summary-windows.js";
import type { LogTable } from "./log-table.js";
import type { QueryWorkgroup } from "./query-workgroup.js";
import { assertRequestedNames } from "./saved-query-names.js";
import type { SavedRollupRequest } from "./rollup-queries.js";
import type { SummaryBucketProps } from "./summary-bucket.js";
import { defaultSummaryLag } from "./summary-lag.js";
import {
  assertOneGranularity,
  assertOneSummaryEach,
} from "./summary-schedule-names.js";

/** What the scheduled summaries need telling. */
export interface RollupSummariesProps extends SummaryBucketProps {
  /** The table the questions read. */
  readonly table: LogTable;

  /** The workgroup they run in, which carries the cutoff. */
  readonly workgroup: QueryWorkgroup;

  /**
   * The questions to compute, which default to the ones Rainlytics ships.
   *
   * The same list `RollupQueries` takes, and a site usually passes the same
   * value to both so that the query saved in the console is the query the
   * schedule runs.
   */
  readonly rollups?: readonly Rollup[] | undefined;

  /**
   * What each question covers, by the name of its rollup.
   *
   * Per question, for the reason `RollupQueries` gives. `/search/` is the
   * search page to `searches` and one directory of a site to `pageviews`.
   *
   * The narrowing is recorded in every summary the question produces, so a
   * reader can see what was counted. Two narrowings of one question are two
   * questions and want two rollups with two names, since the key holds only
   * the name.
   */
  readonly requests?: Readonly<Record<string, SavedRollupRequest>> | undefined;

  /**
   * Which windows to compute.
   *
   * @default hours and days, being {@link summaryGranularities}
   */
  readonly granularities?: readonly SummaryGranularity[] | undefined;

  /**
   * How long after a window closes a run computes it.
   *
   * @default fifteen minutes, being {@link defaultSummaryLag}
   */
  readonly lag?: Duration | undefined;

  /**
   * How many closed windows each run computes, newest first.
   *
   * @default two, being {@link defaultRecomputedWindows}
   */
  readonly recomputedWindows?: number | undefined;

  /**
   * How long one run may take.
   *
   * @default five minutes
   */
  readonly timeout?: Duration | undefined;

  /**
   * How long the function's logs are kept.
   *
   * @default a month
   */
  readonly logRetention?: RetentionDays | undefined;
}

/** The same, with every choice made. */
export interface SummaryConfiguration {
  /** The questions to compute. */
  readonly rollups: readonly Rollup[];

  /** The windows to compute them over. */
  readonly granularities: readonly SummaryGranularity[];

  /** How many closed windows each run computes. */
  readonly windows: number;

  /** How long after a window closes a run fires. */
  readonly lag: Duration;
}

/**
 * The configuration a deployment runs under, with what it left out filled in
 * and what it cannot mean refused.
 *
 * Every refusal happens at synthesis. A deployment that computed nothing, or
 * computed two questions under one name, would deploy green and go wrong
 * hours later in a bucket nobody is watching.
 *
 * @throws {Error} for a set of questions or windows this cannot compute.
 */
export function summaryConfiguration(
  props: RollupSummariesProps,
): SummaryConfiguration {
  const computing = props.rollups ?? rollups;
  const granularities = props.granularities ?? summaryGranularities;

  assertOneSummaryEach(computing);
  assertRequestedNames(computing, Object.keys(props.requests ?? {}));
  assertOneGranularity(granularities);

  return {
    rollups: computing,
    granularities,
    windows: props.recomputedWindows ?? defaultRecomputedWindows,
    lag: props.lag ?? defaultSummaryLag,
  };
}
