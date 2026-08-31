import {
  assertObjectEquals,
  assertStringIncludes,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { deploymentFrom, summaryEnvironment } from "./summary-deployment.js";

describe("where the job reads and writes", () => {
  const anEnvironment = (): Record<string, string> => ({
    [summaryEnvironment.database]: faker.word.noun(),
    [summaryEnvironment.workgroup]: faker.word.noun(),
    [summaryEnvironment.bucket]: faker.string.uuid(),
    [summaryEnvironment.windows]: "2",
    [summaryEnvironment.visitorSaltParameter]: `/${faker.word.noun()}/salt`,
  });

  it("is read out of the environment the construct set", () => {
    // Given a function deployed with everything it needs.
    const environment = anEnvironment();

    // When the job reads it.
    const deployment = deploymentFrom(environment);

    // Then it knows the table, the workgroup and the bucket.
    assertObjectEquals(deployment, {
      database: environment[summaryEnvironment.database],
      workgroup: environment[summaryEnvironment.workgroup],
      bucket: environment[summaryEnvironment.bucket],
      windows: 2,
      visitorSaltParameter:
        environment[summaryEnvironment.visitorSaltParameter],
    });
  });

  it("refuses an invocation missing one of them", () => {
    // Given an environment with the bucket left out.
    const environment = Object.fromEntries(
      Object.entries(anEnvironment()).filter(
        ([name]) => name !== summaryEnvironment.bucket,
      ),
    );

    // When the job reads it.
    const reading = (): unknown => deploymentFrom(environment);

    // Then it says which variable was missing. A default here would write
    // summaries somewhere nobody reads, and the run would report success.
    {
      const error = assertThrowsError(reading);
      assertStringIncludes(error.message, summaryEnvironment.bucket);
    }
  });

  it("refuses a window count that is not a whole number of windows", () => {
    // Given a deployment whose window count was set to something else.
    const environment = {
      ...anEnvironment(),
      [summaryEnvironment.windows]: "two",
    };

    // When the job reads it.
    const reading = (): unknown => deploymentFrom(environment);

    // Then the message names the variable. Left to the window arithmetic, it
    // would be refused a moment later without saying where the value came
    // from, and a log nobody is watching has one chance to say so.
    {
      const error = assertThrowsError(reading);
      assertStringIncludes(error.message, summaryEnvironment.windows);
    }
    {
      const error = assertThrowsError(reading);
      assertStringMatches(error.message, /"two"/u);
    }
  });

  it("refuses a variable that is there and empty", () => {
    // Given a bucket name set to nothing at all.
    const environment = { ...anEnvironment(), [summaryEnvironment.bucket]: "" };

    // Then it is refused like a missing one.
    {
      const error = assertThrowsError(() => deploymentFrom(environment));
      assertStringIncludes(error.message, summaryEnvironment.bucket);
    }
  });
});
