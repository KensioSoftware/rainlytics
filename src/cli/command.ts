// What a subcommand is, and which ones there are.

import type { CliIo } from "./io.js";
import type { OptionValues } from "./command-line.js";
import type { CliOption } from "./option.js";
import type { CommandOutput } from "./output/result.js";
import { javascriptErrors } from "../javascript-errors-rollup.js";
import { rollups } from "../rollup-questions.js";
import { webVitals } from "../web-vitals-rollup.js";
import { queryCommand } from "./query-command.js";
import { reportCommand } from "./report-command.js";
import { rollupCommand } from "./rollup-commands.js";
import { savedQueryCommand } from "./saved-query-command.js";

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
  ) => Promise<CommandOutput> | CommandOutput;
}

/**
 * The commands `rainlytics` ships with.
 *
 * The named questions first, then a calendar report, then the two that take a
 * question of somebody else's. That order is the one a reader wants.
 * Somebody arriving at `rainlytics --help` is far more likely to want a
 * pageview count than to want to write SQL.
 *
 * `saved-query` is what a site's own rollup runs through. The list here is
 * the questions this package ships, and a question deployed from somewhere
 * else reaches the command line by name.
 */
export const rainlyticsCommands: readonly Command[] = [
  ...rollups.map((rollup) => rollupCommand(rollup)),
  rollupCommand(javascriptErrors),
  rollupCommand(webVitals),
  reportCommand,
  savedQueryCommand,
  queryCommand,
];
