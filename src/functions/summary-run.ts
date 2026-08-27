// What one firing of a schedule asks for.
//
// A schedule carries the question in its target input and the deployment
// carries the rest in the function's environment. The split follows what
// changes: a question is one schedule's own, and the table, the workgroup and
// the bucket belong to the whole deployment.
//
// The SQL travels with the question rather than being built here. It is
// written once at synthesis by the builder every other reader uses, which is
// what puts it in the CloudFormation template where somebody can read what
// the job will run. `windowedSql` fills the window in.

import type { SummaryQuestion } from "../rollup-summaries.js";
import { assertRollupName } from "../rollups.js";
import type { SummaryGranularity } from "../summary-windows.js";
import { summaryGranularities } from "../summary-windows.js";

/** One question, on one cadence, as a schedule hands it over. */
export interface SummaryRun {
  /** The question the summary answers, as the document records it. */
  readonly question: SummaryQuestion;

  /** How long the windows it computes are. */
  readonly granularity: SummaryGranularity;

  /** Its SQL, carrying `windowPlaceholder` where the window goes. */
  readonly sql: string;
}

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
}

/** The environment variables the construct sets on the function. */
export const summaryEnvironment = {
  database: "RAINLYTICS_DATABASE",
  workgroup: "RAINLYTICS_WORKGROUP",
  bucket: "RAINLYTICS_SUMMARY_BUCKET",
  windows: "RAINLYTICS_WINDOWS",
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
  const windows = Number(required(environment, summaryEnvironment.windows));

  return {
    database: required(environment, summaryEnvironment.database),
    workgroup: required(environment, summaryEnvironment.workgroup),
    bucket: required(environment, summaryEnvironment.bucket),
    windows,
  };
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

/**
 * The run one invocation was asked for, read out of what the schedule sent.
 *
 * Checked rather than cast. Scheduler sends whatever its target input holds
 * and a Lambda handler is given `unknown`, so this is where a payload written
 * by anything else is refused. A run that took a malformed payload on trust
 * would put a summary under a key built from whatever it found.
 *
 * @throws {Error} for a payload this cannot read.
 */
export function runFrom(payload: unknown): SummaryRun {
  const found = asRecord(payload);
  const question = asRecord(found["question"]);
  const granularity = found["granularity"];
  const sql = found["sql"];

  if (
    typeof sql !== "string" ||
    typeof question["name"] !== "string" ||
    !isGranularity(granularity)
  ) {
    throw refusal(payload);
  }

  assertRollupName(question["name"]);

  /*
   * The three fields the job itself reads are checked above. What is under
   * `question` is recorded in the document and never acted on, and a list of
   * its fields written out here would be a second statement of
   * `RollupRequest`. `SummaryQuestion` is defined as that type minus two
   * fields for exactly that reason, and the copy that drifts is always the
   * one nothing deploys. The name is checked because the key is built from
   * it.
   */
  return {
    question: question as unknown as SummaryQuestion,
    granularity,
    sql,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw refusal(value);
  }

  return value as Readonly<Record<string, unknown>>;
}

function isGranularity(value: unknown): value is SummaryGranularity {
  return summaryGranularities.includes(value as SummaryGranularity);
}

function refusal(payload: unknown): Error {
  return new Error(
    `The rollup summary job was invoked with something it cannot read.` +
      ` It expects a question, a granularity and the SQL, as RollupSummaries` +
      ` writes into a schedule's target input. Got ${JSON.stringify(payload)}.`,
  );
}
