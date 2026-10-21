// Reading one option's text as the value a request needs.
//
// Apart from `rollup-options.ts`, which assembles a whole command line into
// one request. Each of these takes what one option collected and hands back
// something a request can carry, and the three that can be given nonsense
// refuse it before anything reaches Athena.

import { defaultLogDataset, defaultWorkgroupName } from "../dataset.js";
import { defaultRedirectStatuses } from "../rollups.js";
import type { OptionValue } from "./command-line.js";
import { valuesOf } from "./command-line.js";
import { UsageError } from "./failure.js";
import { databaseVariable, workgroupVariable } from "./query-help.js";
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
 * The countries `--country` named, as the codes CloudFront writes.
 *
 * Upper case whatever was typed, since `c-country` holds `GB` and a narrowing
 * to `gb` would match nothing and answer with an empty table.
 *
 * @throws {UsageError} for anything that is not a two-letter code, which
 *   would otherwise count nothing and look like a quiet day.
 */
export function countriesFrom(
  value: OptionValue,
  command: string,
): readonly string[] {
  const countries = eachChosen(value).map((code) => code.trim().toUpperCase());
  const refused = countries.find((code) => !/^[A-Z]{2}$/u.test(code));

  if (refused !== undefined) {
    throw new UsageError(
      `--country takes a two-letter country code, as in GB. Got` +
        ` "${refused}".`,
      command,
    );
  }

  return countries;
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
 * The bucket to read summaries from, where anything named one.
 *
 * The option first and the environment behind it, the way the AWS SDK takes a
 * region. An empty value counts as nothing named, since an unset variable in a
 * shell script expands to one and a bucket called "" would be reported as a
 * missing object for every window.
 */
export function summaryBucketFrom(value: unknown): string | undefined {
  return named(value, summaryBucketVariable);
}

/**
 * The Glue database an unqualified table name is resolved against.
 *
 * The option, then the environment, then the name `LogTable` creates. A
 * deployment that renamed the database sets the variable once and stops
 * passing --database on every command that reaches Athena.
 */
export function databaseFrom(value: unknown): string {
  return named(value, databaseVariable) ?? defaultLogDataset.databaseName;
}

/**
 * The Athena workgroup a query runs in.
 *
 * The option, then the environment, then the name `QueryWorkgroup` creates.
 */
export function workgroupFrom(value: unknown): string {
  return named(value, workgroupVariable) ?? defaultWorkgroupName;
}

/**
 * What an option was given, or what its environment variable holds.
 *
 * An empty value counts as nothing named. An unset variable in a shell script
 * expands to one, and a workgroup called "" would be refused by Athena for a
 * reason the reader has to work backwards from.
 */
function named(value: unknown, variable: string): string | undefined {
  const chose = chosen(value) ?? process.env[variable] ?? "";

  return chose === "" ? undefined : chose;
}
