// The options a command line carries, described once.
//
// Each option is described here in a form both halves can read, the parser
// that accepts it and the `--help` that documents it. Two lists would drift,
// and the way they drift is an option that works and is undocumented, or one
// that is documented and does nothing.

import { outputFormats } from "./output/format.js";
import { listOf } from "./text-layout.js";

/** One option, as the parser and `--help` both need it. */
export interface CliOption {
  /** The long name, without the leading dashes. */
  readonly name: string;

  /** A one-letter alias, where the option has one. */
  readonly short?: string | undefined;

  /** Whether the option takes a value. */
  readonly type: "string" | "boolean";

  /**
   * Whether giving the option again adds to what it holds.
   *
   * An option without this keeps the last value it was given. Somebody
   * correcting a line they are still typing expects that. One with it keeps
   * every value, for a question that can be asked of several things at once.
   */
  readonly multiple?: boolean | undefined;

  /** What to call the value in help, for an option that takes one. */
  readonly valueName?: string | undefined;

  /** The values accepted, for an option that takes one of a fixed set. */
  readonly choices?: readonly string[] | undefined;

  /** What the option does, for `--help`. */
  readonly description: string;
}

/**
 * `--output`, which every command carries.
 *
 * The default is chosen when the command runs, from whether standard output
 * is a terminal, so it cannot be stated as a value here.
 */
export const outputOption: CliOption = {
  name: "output",
  short: "o",
  type: "string",
  valueName: "format",
  choices: outputFormats,
  description:
    `How the result is written. ${listOf(outputFormats)}. Defaults to` +
    ` table when standard output is a terminal and to json when it is piped` +
    ` or redirected. A pipeline therefore needs no flag.`,
};

/** `--help`, which every command carries and the root command carries too. */
export const helpOption: CliOption = {
  name: "help",
  short: "h",
  type: "boolean",
  description: "Show this help and exit.",
};

/** `--version`, which only the root command carries. */
export const versionOption: CliOption = {
  name: "version",
  type: "boolean",
  description: "Print the installed Rainlytics version and exit.",
};

/** The options every subcommand accepts, before its own. */
export const commonOptions: readonly CliOption[] = [outputOption, helpOption];

/**
 * The options accepted before a subcommand has been named.
 *
 * `--output` is here as well as on every command, so that a line putting it
 * first is read and answered rather than refused as an unknown flag.
 */
export const rootOptions: readonly CliOption[] = [
  outputOption,
  helpOption,
  versionOption,
];
