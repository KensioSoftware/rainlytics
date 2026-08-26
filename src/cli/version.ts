// The version the CLI reports, read out of the package it was installed as.
//
// A bug report against a pre-1.0 tool is worth little without one, and there
// is no second place to keep the number where the two could disagree.

import { readFileSync } from "node:fs";

/**
 * Where package.json sits from here.
 *
 * Two directories up, which holds in `src/cli` and in the published
 * `dist/cli` alike.
 */
const packageJson = new URL("../../package.json", import.meta.url);

/**
 * The version in package.json.
 *
 * @throws {Error} when the file carries no version string, which would
 *   otherwise have `--version` print `undefined`.
 */
export function readPackageVersion(from: URL = packageJson): string {
  const parsed: unknown = JSON.parse(readFileSync(from, "utf8"));

  const version =
    typeof parsed === "object" && parsed !== null && "version" in parsed
      ? parsed.version
      : undefined;

  if (typeof version !== "string") {
    throw new TypeError(`No version string in ${from.href}.`);
  }

  return version;
}
