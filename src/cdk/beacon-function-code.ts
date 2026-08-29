// Where the beacon's CloudFront Function source is.
//
// The function is a `.cff.js` file rather than a string in TypeScript. The
// CloudFront Functions JS 2.0 runtime forbids most of the language, and the
// oxlint plugin @kensio/yulin ships checks a file with that extension against
// the restrictions. A template literal in a `.ts` file is invisible to it.
//
// `pnpm build` copies the file into `dist/cdk/`, beside the compiled
// construct. The path below is worked out from this module's own URL and
// lands in the same place from either build, because `src/cdk/` and
// `dist/cdk/` are both one directory inside the package root. `summaryCodePath`
// resolves the rollup function's deployment package the same way.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The file `FunctionCode.fromFile` reads the beacon's 204 handler out of.
 *
 * @throws {Error} where the build has not run. CDK would otherwise report a
 *   missing file without saying which build was meant to write it, and the
 *   same message arrives whether a consumer's install is broken or a
 *   contributor skipped `pnpm build`.
 */
export function beaconFunctionCodePath(): string {
  const path = fileURLToPath(
    new URL("../../dist/cdk/beacon-204.cff.js", import.meta.url),
  );

  if (!existsSync(path)) {
    throw new Error(
      `The beacon's CloudFront Function is not at ${path}. Working in the` +
        ` Rainlytics repository, run "pnpm build" first. Installed from npm,` +
        ` this is a broken package and worth reporting at` +
        ` https://github.com/KensioSoftware/rainlytics/issues.`,
    );
  }

  return path;
}
