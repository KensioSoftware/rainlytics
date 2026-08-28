// Turning one command line into one rollup request.
//
// The reading is here and the running is next door, because a mistyped range
// or row count is a mistake in what was typed and should be reported as one
// before anything reaches Athena. `option-values.ts` holds the readers this
// assembles from, one per option.

import { defaultLogDataset, defaultWorkgroupName } from "../dataset.js";
import type { Rollup, RollupRequest } from "../rollups.js";
import { rollupRequest } from "../rollups.js";
import type { TimeRange } from "../time-range.js";
import type { CommandContext } from "./command.js";
import {
  chosen,
  counted,
  eachChosen,
  rangeFrom,
  statusesFrom,
  summaryBucketFrom,
} from "./option-values.js";
import { defaultLimit, defaultParam } from "./rollup-help.js";
import type { NarrowingOption } from "./summary-question.js";
import { narrowingOptions } from "./summary-question.js";

/** What one rollup was asked for, read off the command line. */
export interface RollupAsked {
  /** The question, with its range and filters. */
  readonly request: RollupRequest;

  /**
   * The span `--last` named, as the summary reader needs it.
   *
   * The same value the request carries. `RollupRequest.range` widens to the
   * two standing ranges a saved query and a schedule use, and a command line
   * always names a span with two ends.
   */
  readonly range: TimeRange;

  /**
   * The narrowing options this command line actually named.
   *
   * Read before the defaults go in, and this is the only place the two can
   * still be told apart. `rollupRequest` fills in a value for every field of
   * every question. A `RollupRequest` carrying `limit: 20` says nothing about
   * whether anybody typed `--limit 20`.
   *
   * `summary-adoption.ts` is what needs the difference. A filter nobody named
   * is one the stored summaries can supply, and a filter somebody named is one
   * they have to match.
   */
  readonly named: ReadonlySet<NarrowingOption>;

  /** The bucket holding the precomputed answers, where one is known. */
  readonly summaries: string | undefined;

  /** Whether the run was told to query Athena rather than read a summary. */
  readonly runsTheQuery: boolean;

  /** The Glue database the query runs against. */
  readonly database: string;

  /** The workgroup it runs in, which carries the cutoff. */
  readonly workgroup: string;

  /** The region to ask, or undefined to leave it to the SDK's chain. */
  readonly region: string | undefined;
}

/**
 * The narrowing options that arrived on one command line.
 *
 * `narrowingOptions` spells each one as a reader types it, and the parser keys
 * on the long name without the dashes. An option nobody gave is absent from
 * the values, whatever default the request will carry for it.
 */
function namedOn(context: CommandContext): ReadonlySet<NarrowingOption> {
  return new Set(
    narrowingOptions.filter(
      (option) => context.options[option.slice(2)] !== undefined,
    ),
  );
}

/**
 * One command line, read as a rollup request.
 *
 * @throws {UsageError} for a range, a row count or a list of statuses
 *   nobody could act on.
 */
export function requestFrom(
  context: CommandContext,
  rollup: Rollup,
): RollupAsked {
  const database =
    chosen(context.options["database"]) ?? defaultLogDataset.databaseName;
  const range = rangeFrom(context.options["last"], rollup.name);

  return {
    database,
    range,
    named: namedOn(context),
    workgroup: chosen(context.options["workgroup"]) ?? defaultWorkgroupName,
    region: chosen(context.options["region"]),
    summaries: summaryBucketFrom(context.options["summaries"]),
    runsTheQuery: context.options["query"] === true,
    request: rollupRequest({
      range,
      includeBots: context.options["include-bots"] === true,
      limit: counted(
        context.options["limit"],
        "limit",
        defaultLimit,
        rollup.name,
      ),
      param: chosen(context.options["param"]) ?? defaultParam,
      redirectStatuses: statusesFrom(
        context.options["redirect-status"],
        rollup.name,
      ),
      paths: eachChosen(context.options["path"]),
      host: chosen(context.options["host"]),
      dataset: {
        databaseName: database,
        tableName: defaultLogDataset.tableName,
      },
    }),
  };
}
