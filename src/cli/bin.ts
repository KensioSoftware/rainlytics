#!/usr/bin/env node
// The executable `npx @kensio/rainlytics` runs.
//
// Wiring only. Everything worth testing is in `run.ts`, which this hands the
// real streams and the real command list.
//
// Nothing here or below it imports `aws-cdk-lib` or `constructs`. Those are
// optional peer dependencies, so a CLI-only install has neither, and
// `scripts/sh/pack-check.sh` runs this file out of the packed tarball with no
// `node_modules` beside it to prove it.

import { rainlyticsCommands } from "./command.js";
import { runCli } from "./run.js";

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  commands: rainlyticsCommands,
  io: {
    out: (text) => {
      process.stdout.write(text);
    },
    error: (text) => {
      process.stderr.write(text);
    },
    /*
     * `isTTY` is undefined rather than false on a stream that is not one, and
     * the difference decides the default output format.
     */
    outIsTerminal: process.stdout.isTTY,
  },
});
