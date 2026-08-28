// Where one deployment of the scheduled job reads and writes.
//
// Apart from `summary-run.ts` because the two are told by different people.
// The deployment is set once by the construct and reaches the function as
// environment variables, and the run arrives on every firing in a schedule's
// target input. A deployment is wrong at deploy time and a payload is wrong
// at run time.

/** Where the job reads and writes, as the deployment set it. */
export interface SummaryDeployment {
  /** The Glue database an unqualified table name resolves against. */
  readonly database: string;

  /** The workgroup, carrying the cutoff and the results location. */
  readonly workgroup: string;

  /** The bucket summaries are written to. */
  readonly bucket: string;

  /** How many closed windows each run computes, newest first. */
  readonly windows: number;

  /**
   * The SSM parameter holding the visitor salt secret.
   *
   * Set on every deployment whether or not any of its questions count
   * visitors. The parameter itself is read only by a run that has a visitor
   * count to compute, so a deployment counting none never asks for it and
   * never needs one to exist.
   */
  readonly visitorSaltParameter: string;
}

/** The environment variables the construct sets on the function. */
export const summaryEnvironment = {
  database: "RAINLYTICS_DATABASE",
  workgroup: "RAINLYTICS_WORKGROUP",
  bucket: "RAINLYTICS_SUMMARY_BUCKET",
  windows: "RAINLYTICS_WINDOWS",
  visitorSaltParameter: "RAINLYTICS_VISITOR_SALT_PARAMETER",
} as const;

/**
 * The deployment, read out of the environment.
 *
 * Every value is required. A function missing one was deployed by something
 * other than the construct, and a job that carried on with a default would
 * write summaries to a bucket nobody reads or query a table nobody delivers
 * to. Both look healthy from where the job stands.
 *
 * @throws {Error} naming the variable that was missing.
 */
export function deploymentFrom(
  environment: Readonly<Record<string, string | undefined>>,
): SummaryDeployment {
  return {
    database: required(environment, summaryEnvironment.database),
    workgroup: required(environment, summaryEnvironment.workgroup),
    bucket: required(environment, summaryEnvironment.bucket),
    windows: windowCount(required(environment, summaryEnvironment.windows)),
    visitorSaltParameter: required(
      environment,
      summaryEnvironment.visitorSaltParameter,
    ),
  };
}

/**
 * How many windows the deployment asked for, as a number.
 *
 * Checked here rather than left to `recomputedWindows`, which would refuse it
 * a moment later without naming the variable it came from. A log entry
 * nobody is watching has one chance to say what is wrong with the
 * deployment.
 *
 * @throws {Error} naming the variable and what it held.
 */
function windowCount(asked: string): number {
  const windows = Number(asked);

  if (!Number.isSafeInteger(windows) || windows < 1) {
    throw new Error(
      `${summaryEnvironment.windows} is a whole number of windows, at least` +
        ` one, and this invocation had "${asked}".`,
    );
  }

  return windows;
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const found = environment[name];

  if (found === undefined || found === "") {
    throw new Error(
      `The rollup summary job needs ${name} in its environment, and this` +
        ` invocation had none. RollupSummaries sets it.`,
    );
  }

  return found;
}
