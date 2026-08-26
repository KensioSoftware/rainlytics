// How the CLI reports going wrong.
//
// A shell script gets two things from a failed command, an exit code and
// whatever went to standard error, and both are worth spending a little care
// on.

import type { CliIo } from "./io.js";

/**
 * The exit codes the CLI uses.
 *
 * Two failure codes, because they call for different responses. A `usage`
 * exit means the command line was wrong and running it again unchanged will
 * fail the same way. A `failure` exit means the command ran and could not
 * finish, which is the kind of thing a retry sometimes gets past.
 *
 * 2 for a usage error is the convention `getopt` set and Python's `argparse`
 * kept.
 */
export const exitCodes = {
  /** The command did what was asked. */
  success: 0,

  /** The command ran and could not finish. */
  failure: 1,

  /** The command line was wrong. */
  usage: 2,
} as const;

/**
 * A mistake in what was typed.
 *
 * An unknown command, an unknown option, a missing value, or a value outside
 * what an option accepts. The runner prints the message to standard error,
 * follows it with the one command that would explain the mistake, and exits
 * {@link exitCodes.usage}.
 */
export class UsageError extends Error {
  /**
   * The subcommand whose `--help` explains this, where a subcommand was
   * reached. Left undefined for a mistake made before one was.
   */
  readonly helpFor: string | undefined;

  constructor(message: string, helpFor?: string) {
    super(message);
    this.name = "UsageError";
    this.helpFor = helpFor;
  }
}

/** Writes a failure to standard error and answers with its exit code. */
export function reportFailure(thrown: unknown, io: CliIo): number {
  const message = thrown instanceof Error ? thrown.message : String(thrown);

  io.error(`rainlytics: ${message}\n`);

  if (thrown instanceof UsageError) {
    const help =
      thrown.helpFor === undefined
        ? "rainlytics --help"
        : `rainlytics ${thrown.helpFor} --help`;

    io.error(`Run "${help}" for what it accepts.\n`);

    return exitCodes.usage;
  }

  return exitCodes.failure;
}
