// The command line, reached as `@kensio/rainlytics/cli`.
//
// For a site running `rainlytics` with its own rollups added. The executable
// builds a command for each question this package ships and knows no others.
// A site's own rollup gets the same command, with the same stored reads, the
// same refusals and the same `--query`, by handing it to `rollupCommand` and
// running the list through `runCli`. `docs/command-line/` has the example.
//
// Like the executable, nothing reachable from here imports `aws-cdk-lib` or
// `constructs`. This entry point reaches the AWS SDK and Node built-ins, and
// belongs in a script, never in a page.

export type { OptionValue, OptionValues } from "./command-line.js";
export {
  type Command,
  type CommandContext,
  rainlyticsCommands,
} from "./command.js";
export { exitCodes, UsageError } from "./failure.js";
export type { CliIo } from "./io.js";
export type { CliOption } from "./option.js";
export type {
  Cell,
  CommandOutput,
  CommandResult,
  JsonDocumentResult,
  Row,
} from "./output/result.js";
export { rollupCommand } from "./rollup-commands.js";
export { type CliInvocation, runCli } from "./run.js";
