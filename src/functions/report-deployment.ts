// Where one deployment of the calendar report job reads and writes.

import { summaryEnvironment } from "./summary-deployment.js";

/** The resources shared by every report run in one deployment. */
export interface ReportDeployment {
  readonly database: string;
  readonly workgroup: string;
  readonly bucket: string;
  readonly visitorSaltParameter: string;
}

/** Reads the report deployment out of its Lambda environment. */
export function reportDeploymentFrom(
  environment: Readonly<Record<string, string | undefined>>,
): ReportDeployment {
  return {
    database: required(environment, summaryEnvironment.database),
    workgroup: required(environment, summaryEnvironment.workgroup),
    bucket: required(environment, summaryEnvironment.bucket),
    visitorSaltParameter: required(
      environment,
      summaryEnvironment.visitorSaltParameter,
    ),
  };
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const found = environment[name];

  if (found === undefined || found === "") {
    throw new Error(
      `The calendar report job needs ${name} in its environment, and this` +
        ` invocation had none. RollupSummaries sets it.`,
    );
  }

  return found;
}
