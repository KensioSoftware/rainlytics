// Turning one command line into one rollup request.
//
// The reading is here and the running is next door, because a mistyped range
// or row count is a mistake in what was typed and should be reported as one
// before anything reaches Athena.

import { defaultLogDataset, defaultWorkgroupName } from "../dataset.js";
import type { Rollup, RollupRequest } from "../rollups.js";
import { rollupRequest } from "../rollups.js";
import type { TimeRange } from "../time-range.js";
import { lastRange } from "../time-range.js";
import type { CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
import { defaultLast, defaultLimit } from "./rollup-help.js";

/** The text of an option, where one was given. */
function chosen(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * A whole number an option was given, or the default.
 *
 * @throws {UsageError} for anything that is not one.
 */
function counted(
  value: string | boolean | undefined,
  option: string,
  fallback: number,
  command: string,
): number {
  const text = chosen(value);

  if (text === undefined) {
    return fallback;
  }

  const parsed = Number(text);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new UsageError(
      `--${option} takes a whole number of 1 or more. Got "${text}".`,
      command,
    );
  }

  return parsed;
}

/**
 * The range `--last` asked for.
 *
 * @throws {UsageError} for a span the parser cannot read, so a mistyped range
 *   is reported as the command-line mistake it is.
 */
function rangeFrom(context: CommandContext, command: string): TimeRange {
  const asked = chosen(context.options["last"]) ?? defaultLast;

  try {
    return lastRange(asked, new Date());
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
      command,
    );
  }
}

/** What one rollup was asked for, read off the command line. */
export interface RollupAsked {
  /** The question, with its range and filters. */
  readonly request: RollupRequest;

  /** The Glue database the query runs against. */
  readonly database: string;

  /** The workgroup it runs in, which carries the cutoff. */
  readonly workgroup: string;
}

/**
 * One command line, read as a rollup request.
 *
 * @throws {UsageError} for a range or a row count nobody could act on.
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
    request: rollupRequest({
      range: rangeFrom(context, rollup.name),
      includeBots: context.options["include-bots"] === true,
      limit: counted(
        context.options["limit"],
        "limit",
        defaultLimit,
        rollup.name,
      ),
      dataset: {
        databaseName: database,
        tableName: defaultLogDataset.tableName,
      },
    }),
  };
}
