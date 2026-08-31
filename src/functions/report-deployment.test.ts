import {
  assertObjectEquals,
  assertStringIncludes,
  assertThrowsError,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { summaryEnvironment } from "./summary-deployment.js";
import { reportDeploymentFrom } from "./report-deployment.js";

describe("where the calendar report job reads and writes", () => {
  const anEnvironment = (): Record<string, string> => ({
    [summaryEnvironment.database]: faker.word.noun(),
    [summaryEnvironment.workgroup]: faker.word.noun(),
    [summaryEnvironment.bucket]: faker.string.uuid(),
    [summaryEnvironment.visitorSaltParameter]: `/${faker.word.noun()}/salt`,
  });

  it("reads every shared resource from the function environment", () => {
    // Given the environment written by ReportFunction.
    const environment = anEnvironment();

    // When the report job reads it.
    const deployment = reportDeploymentFrom(environment);

    // Then every resource points at the configured deployment.
    assertObjectEquals(deployment, {
      database: environment[summaryEnvironment.database],
      workgroup: environment[summaryEnvironment.workgroup],
      bucket: environment[summaryEnvironment.bucket],
      visitorSaltParameter:
        environment[summaryEnvironment.visitorSaltParameter],
    });
  });

  it("names a missing or empty variable", () => {
    // Given an environment with no summaries bucket.
    const environment = {
      ...anEnvironment(),
      [summaryEnvironment.bucket]: "",
    };

    // Then the job refuses it at startup and names the setting.
    const error = assertThrowsError(() => reportDeploymentFrom(environment));
    assertStringIncludes(error.message, summaryEnvironment.bucket);
  });
});
