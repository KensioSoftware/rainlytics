// Reading a command line.
//
// Node's `parseArgs` does the reading. What is here is turning its refusals
// into something a person can act on, and holding an option to the values it
// says it accepts.

import { parseArgs } from "node:util";

import { UsageError } from "./failure.js";
import type { CliOption } from "./option.js";
import { listOf } from "./text-layout.js";

/** What an option was set to. A boolean option is absent or `true`. */
export type OptionValues = Readonly<
  Record<string, string | boolean | undefined>
>;

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
  const config: Record<string, { type: "string" | "boolean"; short?: string }> =
    {};

  for (const option of options) {
    config[option.name] =
      option.short === undefined
        ? { type: option.type }
        : { type: option.type, short: option.short };
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
  value: string | boolean | undefined,
  helpFor: string | undefined,
): void {
  if (option.choices === undefined || value === undefined) {
    return;
  }

  if (typeof value !== "string" || !option.choices.includes(value)) {
    throw new UsageError(
      `--${option.name} accepts ${listOf(option.choices)}. Got "${String(value)}".`,
      helpFor,
    );
  }
}
