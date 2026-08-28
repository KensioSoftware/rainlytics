// Reading one option's text as the value a request needs.
//
// Apart from `rollup-options.ts`, which assembles a whole command line into
// one request. Each of these takes what one option collected and hands back
// something a request can carry, and the three that can be given nonsense
// refuse it before anything reaches Athena.

import { defaultRedirectStatuses } from "../rollups.js";
import type { TimeRange } from "../time-range.js";
import { lastRange } from "../time-range.js";
import type { OptionValue } from "./command-line.js";
import { valuesOf } from "./command-line.js";
import { UsageError } from "./failure.js";
import { defaultLast } from "./rollup-help.js";
import { summaryBucketVariable } from "./summary-help.js";

/** The text of an option, where one was given. */
export function chosen(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Every text an option collected, in the order it was given them. */
export function eachChosen(value: OptionValue): readonly string[] {
  return valuesOf(value).filter(
    (given): given is string => typeof given === "string",
  );
}

/**
 * A whole number an option was given, or the default.
 *
 * @throws {UsageError} for anything that is not one.
 */
export function counted(
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
 * The statuses `--redirect-status` named, or the default.
 *
 * One value carrying commas, where `--path` is repeatable. A path is long
 * and arrives one at a time, often out of a shell variable, and three status
 * codes are read and typed as one thing. Spaces around a code are taken off,
 * since a shell keeps whatever was inside the quotes.
 *
 * @throws {UsageError} for anything that is not a list of status codes, the
 *   way `--limit` refuses anything that is not a whole number.
 */
export function statusesFrom(
  value: unknown,
  command: string,
): readonly string[] {
  const text = chosen(value);

  if (text === undefined) {
    return defaultRedirectStatuses;
  }

  const statuses = text.split(",").map((code) => code.trim());

  if (!statuses.every((code) => /^[1-5]\d{2}$/u.test(code))) {
    throw new UsageError(
      `--redirect-status takes HTTP status codes separated by commas, as in` +
        ` ${defaultRedirectStatuses.join(",")}. Got "${text}".`,
      command,
    );
  }

  return statuses;
}

/**
 * The range `--last` asked for, or the default span.
 *
 * @throws {UsageError} for a span the parser cannot read, so a mistyped
 *   range is reported as the command-line mistake it is.
 */
export function rangeFrom(value: unknown, command: string): TimeRange {
  try {
    return lastRange(chosen(value) ?? defaultLast, new Date());
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
      command,
    );
  }
}

/**
 * The bucket to read summaries from, where anything named one.
 *
 * The option first and the environment behind it, the way the AWS SDK takes a
 * region. An empty value counts as nothing named, since an unset variable in a
 * shell script expands to one and a bucket called "" would be reported as a
 * missing object for every window.
 */
export function summaryBucketFrom(value: unknown): string | undefined {
  const named = chosen(value) ?? process.env[summaryBucketVariable] ?? "";

  return named === "" ? undefined : named;
}
