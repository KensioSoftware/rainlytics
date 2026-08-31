import {
  assertIdentical,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { readPackageVersion } from "./version.js";

describe("the version the CLI reports", () => {
  /** Reads a version out of a package.json holding exactly `contents`. */
  const versionIn = (contents: unknown): string => {
    const directory = mkdtempSync(`${tmpdir()}/rainlytics-`);

    try {
      const file = new URL("package.json", pathToFileURL(`${directory}/`));
      writeFileSync(file, JSON.stringify(contents));

      return readPackageVersion(file);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it("is whatever the package was published as", () => {
    // Given a package published at some version.
    const version = faker.system.semver();

    // When the version is read from it.
    // Then it is that version, and not a number kept anywhere else.
    assertIdentical(
      versionIn({ name: "@kensio/rainlytics", version }),
      version,
    );
  });

  it("refuses a package that carries no version", () => {
    // Given a package.json with the version missing.
    const reading = (): string => versionIn({ name: "@kensio/rainlytics" });

    // Then it fails, so `--version` cannot print the word "undefined" at
    // somebody who is filling in a bug report.
    {
      const error = assertThrowsError(reading);
      assertStringMatches(error.message, /no version string/iu);
    }
  });

  it("finds this package's own version with nothing to point it at", () => {
    // Given the repository's package.json, found from the working directory
    // rather than by the arithmetic the module under test does.
    const own: unknown = JSON.parse(readFileSync("package.json", "utf8"));

    // When the version is read with no path given.
    // Then it is this package's. That path has to hold from `src/cli` and
    // from the published `dist/cli` alike.
    assertIdentical(readPackageVersion(), (own as { version: string }).version);
  });
});
