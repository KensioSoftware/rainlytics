// Reading a command line.
//
// Node's `parseArgs` does the reading. What is here is turning its refusals
// into something a person can act on, and holding an option to the values it
// says it accepts.

import { parseArgs } from "node:util";

import { UsageError } from "./failure.js";
import type { CliOption } from "./option.js";
import { listOf } from "./text-layout.js";

/**
 * What one option was set to.
 *
 * A boolean option is absent or `true`. An option that collects its repeats
 * is absent or a list, however many times it was given. Every reader
 * downstream sees the same shape whether it arrived once or twice.
 */
export type OptionValue =
  | string
  | boolean
  | readonly (string | boolean)[]
  | undefined;

/** What every option was set to, by long name. */
export type OptionValues = Readonly<Record<string, OptionValue>>;

/** Everything an option was given, whether it collects its repeats or not. */
export function valuesOf(value: OptionValue): readonly (string | boolean)[] {
  if (value === undefined) {
    return [];
  }

  return typeof value === "string" || typeof value === "boolean"
    ? [value]
    : value;
}

/** One command line, taken apart. */
export interface CommandLine {
  /** The options, by long name, whatever spelling they arrived in. */
  readonly values: OptionValues;

  /** Everything that was not an option or the value of one. */
  readonly positionals: readonly string[];
}

/**
 * Reads `argv` against `options`.
 *
 * `helpFor` names the subcommand a mistake belongs to, so the runner can
 * point at the help that would explain it.
 *
 * @throws {UsageError} for an unknown option, a missing value, or a value
 *   outside what the option accepts.
 */
export function parseCommandLine(
  argv: readonly string[],
  options: readonly CliOption[],
  helpFor?: string,
): CommandLine {
  const parsed = parse(argv, options, helpFor);

  for (const option of options) {
    checkChoices(option, parsed.values[option.name], helpFor);
  }

  return parsed;
}

/** Hands `argv` to Node's parser, and turns its refusals into usage errors. */
function parse(
  argv: readonly string[],
  options: readonly CliOption[],
  helpFor: string | undefined,
): CommandLine {
  const config: Record<
    string,
    { type: "string" | "boolean"; short?: string; multiple?: boolean }
  > = {};

  for (const option of options) {
    config[option.name] = {
      type: option.type,
      ...(option.short === undefined ? {} : { short: option.short }),
      ...(option.multiple === true ? { multiple: true } : {}),
    };
  }

  try {
    return parseArgs({
      args: [...argv],
      options: config,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(
      firstSentence(error instanceof Error ? error.message : String(error)),
      helpFor,
    );
  }
}

/**
 * The first sentence of `message`.
 *
 * Node's parser follows "Unknown option '--wat'" with a paragraph explaining
 * how to pass a positional beginning with a dash. That is advice for a
 * different mistake, and it arrives at the moment somebody is looking for the
 * name they got wrong.
 */
function firstSentence(message: string): string {
  const end = message.indexOf(". ");

  return end === -1 ? message : message.slice(0, end + 1);
}

/**
 * @throws {UsageError} when an option that accepts a fixed set of values was
 *   given something outside it.
 */
function checkChoices(
  option: CliOption,
  value: OptionValue,
  helpFor: string | undefined,
): void {
  if (option.choices === undefined) {
    return;
  }

  for (const given of valuesOf(value)) {
    if (typeof given !== "string" || !option.choices.includes(given)) {
      throw new UsageError(
        `--${option.name} accepts ${listOf(option.choices)}.` +
          ` Got "${String(given)}".`,
        helpFor,
      );
    }
  }
}
