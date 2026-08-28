// The second query one run makes, and the number it comes back with.
//
// Apart from the handler because the handler runs a question and writes an
// object, and this answers a different question over the same window. Apart
// from `visitor-counts.ts` because that writes the SQL and this runs it.
//
// A question that counts no visitors never reaches any of this. It makes one
// query, as it did before KensioSoftware/rainlytics#74, and its summaries
// carry no `visitors` field.

import { runAthenaQuery } from "../athena/athena-query.js";
import type { VisitorCount } from "../rollup-summaries.js";
import { windowedSql } from "../summary-runs.js";
import type { SummaryWindow } from "../summary-windows.js";
import { visitorColumn } from "../visitor-counts.js";
import { saltedSql } from "../visitor-identity.js";
import type { SummaryDeployment } from "./summary-deployment.js";
import { summaryFailure } from "./summary-failure.js";
import type { SummaryRun } from "./summary-run.js";
import { visitorSalt, visitorSecret } from "./visitor-salt.js";

/**
 * What one run needs in order to count visitors.
 *
 * The query and the secret together, because neither is any use alone. A run
 * holding one and not the other would write a summary reporting no visitors
 * over a window full of views, which is the failure nobody would see.
 */
export interface VisitorRun {
  /** The question's name, for the message a failure carries. */
  readonly question: string;

  /** The count's SQL, carrying both placeholders. */
  readonly sql: string;

  /** The deployment's salt secret, which every window derives from. */
  readonly secret: string;
}

/**
 * What a run counts visitors with, or nothing where it counts none.
 *
 * The secret is read once for the whole run and used for every window in it.
 * Each window derives its own day's salt from it, so a run computing two
 * windows either side of midnight counts each of them under its own day.
 *
 * Read before the first query rather than during it. A deployment whose
 * parameter is missing fails on the line that says which parameter, ahead of
 * any Athena charge.
 *
 * @throws {Error} naming the parameter, where the deployment has no secret.
 */
export async function visitorRunFor(
  run: SummaryRun,
  deployment: SummaryDeployment,
): Promise<VisitorRun | undefined> {
  if (run.visitorSql === undefined) {
    return undefined;
  }

  return {
    question: run.question.name,
    sql: run.visitorSql,
    secret: await visitorSecret(deployment.visitorSaltParameter),
  };
}

/**
 * How many visitors one window saw, where the run counts them.
 *
 * The window goes in before the salt. The salt is 64 characters of hex and
 * carries no placeholder of its own, and filling it last keeps that true of
 * whatever a secret turns out to hold.
 *
 * @throws {Error} for a query that did not succeed, and for one that
 *   succeeded with an answer this cannot read.
 */
export async function visitorsIn(
  counting: VisitorRun | undefined,
  window: SummaryWindow,
  deployment: SummaryDeployment,
): Promise<VisitorCount | undefined> {
  if (counting === undefined) {
    return undefined;
  }

  const windowed = windowedSql(counting.sql, window);
  const outcome = await runAthenaQuery({
    sql: saltedSql(windowed, visitorSalt(counting.secret, window)),
    database: deployment.database,
    workgroup: deployment.workgroup,
  });

  if (outcome.state !== "SUCCEEDED") {
    throw summaryFailure(
      outcome,
      `visitors for ${counting.question} at ${window.at.toISOString()}`,
      deployment.workgroup,
    );
  }

  return {
    distinct: distinctIn(outcome.rows, counting, window),
    additive: false,
  };
}

/**
 * The number one answer holds.
 *
 * Athena hands every value back as text and a count arrives as digits. An
 * answer of no rows, an empty cell and anything that is not a whole number
 * are all refused. `Number("")` is zero, and a summary reporting zero
 * visitors over a window full of views would read as a window nobody
 * visited.
 *
 * @throws {Error} naming the question and the window.
 */
function distinctIn(
  rows: readonly Readonly<Record<string, string | undefined>>[],
  counting: VisitorRun,
  window: SummaryWindow,
): number {
  const counted = rows[0]?.[visitorColumn];

  if (
    counted === undefined ||
    !/^\d+$/u.test(counted) ||
    !Number.isSafeInteger(Number(counted))
  ) {
    throw new Error(
      `The visitor count for ${counting.question} at` +
        ` ${window.at.toISOString()} came back as ${JSON.stringify(counted)},` +
        ` which is not a number of visitors. A summary carrying zero here` +
        ` would read as a window nobody visited.`,
    );
  }

  return Number(counted);
}
