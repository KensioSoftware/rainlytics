// Where the scheduled job's deployment package is.
//
// Rainlytics is a library, so the function it deploys is code this package
// ships rather than code a consumer writes. `pnpm build` compiles `src` twice:
// once to the ES modules the package exports, and once to `dist/lambda` as
// CommonJS for the function. The second build is what a Lambda runtime loads
// and what the simulator in the tests can run.
//
// The path is worked out from this module's own URL, which lands in the same
// place from either build. `src/cdk/` and `dist/cdk/` are both one directory
// inside the package root.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The directory `Code.fromAsset` stages for the summary function.
 *
 * @throws {Error} where the build has not run. CDK would otherwise report a
 *   missing directory without saying which build was meant to write it, and
 *   the same message arrives whether a consumer's install is broken or a
 *   contributor skipped `pnpm build`.
 */
export function summaryCodePath(): string {
  const path = fileURLToPath(new URL("../../dist/lambda/", import.meta.url));

  if (!existsSync(path)) {
    throw new Error(
      `The rollup summary function's code is not at ${path}. Working in the` +
        ` Rainlytics repository, run "pnpm build" first. Installed from npm,` +
        ` this is a broken package and worth reporting at` +
        ` https://github.com/KensioSoftware/rainlytics/issues.`,
    );
  }

  return path;
}

/** The handler within it, as Lambda names one. */
export const summaryHandlerName = "functions/rollup-summary.handler";
