// What a subcommand is, and which ones there are.

import type { CliIo } from "./io.js";
import type { OptionValues } from "./command-line.js";
import type { CliOption } from "./option.js";
import type { CommandResult } from "./output/result.js";

/** What a command is handed when it runs. */
export interface CommandContext {
  /** The arguments that were not options, with the command name removed. */
  readonly args: readonly string[];

  /** The options, by long name, including the common ones. */
  readonly options: OptionValues;

  /** The two streams. A command writes progress and warnings to `error`. */
  readonly io: CliIo;
}

/** One subcommand of `rainlytics`. */
export interface Command {
  /** The word that selects it, as in `rainlytics query`. */
  readonly name: string;

  /** One line, for the command list in `rainlytics --help`. */
  readonly summary: string;

  /**
   * What the command does, for its own `--help`.
   *
   * Prose for a person to read, and as long as the command deserves. This is
   * the documentation for the command, and a reader should need nothing else
   * after it.
   */
  readonly description: string;

  /**
   * The usage line, where the command takes arguments.
   *
   * @default `rainlytics <name> [options]`
   */
  readonly usage?: string | undefined;

  /** Options this command accepts beyond the common ones. */
  readonly options?: readonly CliOption[] | undefined;

  /** Runs the command and answers with what it found. */
  readonly run: (
    context: CommandContext,
  ) => Promise<CommandResult> | CommandResult;
}

/**
 * The commands `rainlytics` ships with.
 *
 * Empty. This release is the command line itself, being the argument parsing,
 * the output formats, the help and the exit codes. Reading data back is
 * https://github.com/KensioSoftware/rainlytics/issues/23 and the named
 * questions are #24.
 */
export const rainlyticsCommands: readonly Command[] = [];
