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
import type { OptionValue } from "./command-line.js";
import { valuesOf } from "./command-line.js";
import type { CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
import { defaultLast, defaultLimit, defaultParam } from "./rollup-help.js";

/** The text of an option, where one was given. */
function chosen(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Every text an option collected, in the order it was given them. */
function eachChosen(value: OptionValue): readonly string[] {
  return valuesOf(value).filter(
    (given): given is string => typeof given === "string",
  );
}

/**
 * A whole number an option was given, or the default.
 *
 * @throws {UsageError} for anything that is not one.
 */
function counted(
  value: unknown,
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
      param: chosen(context.options["param"]) ?? defaultParam,
      paths: eachChosen(context.options["path"]),
      host: chosen(context.options["host"]),
      dataset: {
        databaseName: database,
        tableName: defaultLogDataset.tableName,
      },
    }),
  };
}
