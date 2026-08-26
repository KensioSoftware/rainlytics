// A command line in, an exit code out.
//
// The whole run is here, which is what lets the tests drive the same function
// the executable drives and read back the two streams a shell would have
// seen. `bin.ts` holds the wiring and nothing else.
//
// A command name comes before the options that belong to it. That is what
// `rainlytics <command> [options]` in the help means, and it is why finding
// the command is reading the first argument rather than scanning the line for
// the first thing that is not an option or the value of one.

import { parseCommandLine } from "./command-line.js";
import type { Command } from "./command.js";
import { exitCodes, reportFailure, UsageError } from "./failure.js";
import { commandHelp, rootHelp } from "./help.js";
import type { CliIo } from "./io.js";
import { commonOptions, rootOptions } from "./option.js";
import { chosenFormat, render } from "./output/format.js";
import { readPackageVersion } from "./version.js";

/** One run of the CLI. */
export interface CliInvocation {
  /** The arguments after the program name, being `process.argv.slice(2)`. */
  readonly argv: readonly string[];

  /** The commands available, which is what `rainlytics --help` lists. */
  readonly commands: readonly Command[];

  /** Where the run writes, and whether standard output is a terminal. */
  readonly io: CliIo;
}

/** Runs a command line and answers with the code the process should exit on. */
export async function runCli(invocation: CliInvocation): Promise<number> {
  try {
    return await dispatch(invocation);
  } catch (error) {
    return reportFailure(error, invocation.io);
  }
}

/** Picks the command, or handles a line that named none. */
async function dispatch(invocation: CliInvocation): Promise<number> {
  const [first, ...rest] = invocation.argv;

  if (first === undefined || first.startsWith("-")) {
    return runRoot(invocation);
  }

  const command = invocation.commands.find((each) => each.name === first);

  if (command === undefined) {
    throw new UsageError(`There is no "${first}" command.`);
  }

  return runCommand(command, rest, invocation);
}

/** Handles a line that named no command. */
function runRoot(invocation: CliInvocation): number {
  const { values, positionals } = parseCommandLine(
    invocation.argv,
    rootOptions,
  );

  if (values["version"] === true) {
    invocation.io.out(`${readPackageVersion()}\n`);
    return exitCodes.success;
  }

  const help = rootHelp(invocation.commands);

  if (values["help"] === true) {
    invocation.io.out(help);
    return exitCodes.success;
  }

  const [misplaced] = positionals;

  if (misplaced !== undefined) {
    throw new UsageError(
      `A command comes before its options. Try "rainlytics ${misplaced}"` +
        ` with everything else after it.`,
    );
  }

  /*
   * Nothing was asked for. The help is the useful answer, and it goes to
   * standard error at a usage exit, so `rainlytics | jq` is handed nothing
   * rather than a page of prose shaped like data.
   */
  invocation.io.error(help);
  return exitCodes.usage;
}

/** Runs one command and writes what it found. */
async function runCommand(
  command: Command,
  argv: readonly string[],
  invocation: CliInvocation,
): Promise<number> {
  const { values, positionals } = parseCommandLine(
    argv,
    [...commonOptions, ...(command.options ?? [])],
    command.name,
  );

  if (values["help"] === true) {
    invocation.io.out(commandHelp(command));
    return exitCodes.success;
  }

  const result = await command.run({
    args: positionals,
    options: values,
    io: invocation.io,
  });

  invocation.io.out(
    render(result, chosenFormat(values["output"], invocation.io.outIsTerminal)),
  );

  return exitCodes.success;
}
