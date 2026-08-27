// Turning one command line into one rollup request.
//
// The reading is here and the running is next door, because a mistyped range
// or row count is a mistake in what was typed and should be reported as one
// before anything reaches Athena. `option-values.ts` holds the readers this
// assembles from, one per option.

import { defaultLogDataset, defaultWorkgroupName } from "../dataset.js";
import type { Rollup, RollupRequest } from "../rollups.js";
import { rollupRequest } from "../rollups.js";
import type { CommandContext } from "./command.js";
import {
  chosen,
  counted,
  eachChosen,
  rangeFrom,
  statusesFrom,
} from "./option-values.js";
import { defaultLimit, defaultParam } from "./rollup-help.js";

/** What one rollup was asked for, read off the command line. */
export interface RollupAsked {
  /** The question, with its range and filters. */
  readonly request: RollupRequest;

  /** The Glue database the query runs against. */
  readonly database: string;

  /** The workgroup it runs in, which carries the cutoff. */
  readonly workgroup: string;

  /** The region to ask, or undefined to leave it to the SDK's chain. */
  readonly region: string | undefined;
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

  return {
    database,
    workgroup: chosen(context.options["workgroup"]) ?? defaultWorkgroupName,
    region: chosen(context.options["region"]),
    request: rollupRequest({
      range: rangeFrom(context.options["last"], rollup.name),
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
