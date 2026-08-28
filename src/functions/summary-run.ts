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
import { assertRollupName, currentMonth, rollupRequest } from "../rollups.js";
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
  return {
    database: required(environment, summaryEnvironment.database),
    workgroup: required(environment, summaryEnvironment.workgroup),
    bucket: required(environment, summaryEnvironment.bucket),
    windows: windowCount(required(environment, summaryEnvironment.windows)),
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

  if (typeof sql !== "string" || !isGranularity(granularity)) {
    throw refusal(payload);
  }

  return { question: questionFrom(question), granularity, sql };
}

/**
 * The fields a question carries, read off a request rather than written out.
 *
 * `SummaryQuestion` is `RollupRequest` minus the two fields a summary settles
 * for itself, and it is defined that way so that a filter added to the
 * commands is a filter recorded in the document without anybody remembering.
 * A list of names typed out here would undo that, and the copy that drifts is
 * always the one nothing deploys. `rollupRequest` fills in every field that
 * has a default, so its keys are the ones a payload has to carry. The two
 * that have no default, `paths` and `host`, are optional in the type and are
 * absent from a question that did not narrow.
 */
const questionFields: readonly string[] = Object.keys(
  rollupRequest({ range: currentMonth }),
).filter((field) => field !== "dataset" && field !== "range");

/**
 * The question one payload names, checked rather than cast.
 *
 * Scheduler sends whatever its target input holds. A payload short of a field
 * would reach S3 as a summary describing a question nobody asked, and the
 * reader comparing it against what somebody wanted would find a field
 * missing rather than different.
 *
 * @throws {Error} for a question this cannot read.
 */
function questionFrom(
  question: Readonly<Record<string, unknown>>,
): SummaryQuestion {
  if (typeof question["name"] !== "string") {
    throw refusal(question);
  }

  // The key is built from the name, so a name no key can carry is refused
  // with the message that says which names one can.
  assertRollupName(question["name"]);

  const missing = questionFields.filter((field) => !(field in question));

  if (missing.length > 0) {
    throw new Error(
      `The question "${question["name"]}" is missing ${missing.join(", ")}.` +
        ` RollupSummaries writes every field a rollup request carries into a` +
        ` schedule's target input, and a summary records them all.`,
    );
  }

  return question as unknown as SummaryQuestion;
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
