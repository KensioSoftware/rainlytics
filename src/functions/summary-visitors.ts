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
import type { SummaryWindow } from "../summary-windows.js";
import { visitorColumn } from "../visitor-counts.js";
import { saltedSql } from "../visitor-identity.js";
import { windowedSql } from "../summary-runs.js";
import { summaryFailure } from "./summary-failure.js";
import type { SummaryDeployment } from "./summary-deployment.js";
import type { SummaryRun } from "./summary-run.js";
import { visitorSalt, visitorSecret } from "./visitor-salt.js";

/**
 * The secret one run needs, or nothing where it counts no visitors.
 *
 * Read once for the whole run and used for every window in it. Each window
 * derives its own day's salt from it, so a run computing two windows either
 * side of midnight counts each of them under its own day.
 *
 * Read before the first query rather than during it. A deployment whose
 * parameter is missing fails on the line that says which parameter, ahead of
 * any Athena charge.
 */
export async function runSecret(
  run: SummaryRun,
  deployment: SummaryDeployment,
): Promise<string | undefined> {
  return run.visitorSql === undefined
    ? undefined
    : visitorSecret(deployment.visitorSaltParameter);
}

/**
 * How many visitors one window saw, where the run counts them.
 *
 * @throws {Error} for a query that did not succeed, and for one that
 *   succeeded with an answer this cannot read. A summary reporting no
 *   visitors over a window full of views is the failure nobody would see, and
 *   a failed run at least stops the summaries appearing.
 */
export async function visitorsIn(
  run: SummaryRun,
  window: SummaryWindow,
  deployment: SummaryDeployment,
  secret: string | undefined,
): Promise<VisitorCount | undefined> {
  if (run.visitorSql === undefined || secret === undefined) {
    return undefined;
  }

  const salted = saltedSql(run.visitorSql, visitorSalt(secret, window));
  const outcome = await runAthenaQuery({
    sql: windowedSql(salted, window),
    database: deployment.database,
    workgroup: deployment.workgroup,
  });

  if (outcome.state !== "SUCCEEDED") {
    throw summaryFailure(
      outcome,
      `visitors for ${run.question.name} at ${window.at.toISOString()}`,
      deployment.workgroup,
    );
  }

  return { distinct: distinctIn(outcome.rows, run, window), additive: false };
}

/**
 * The number one answer holds.
 *
 * Athena hands every value back as text and the count arrives as digits. An
 * answer of no rows, or one carrying something other than a whole number, is
 * refused. Both would otherwise become a plausible zero.
 *
 * @throws {Error} naming the question and the window.
 */
function distinctIn(
  rows: readonly Readonly<Record<string, string | undefined>>[],
  run: SummaryRun,
  window: SummaryWindow,
): number {
  const [first] = rows;
  const counted = Number(first?.[visitorColumn]);

  if (!Number.isSafeInteger(counted) || counted < 0) {
    throw new Error(
      `The visitor count for ${run.question.name} at` +
        ` ${window.at.toISOString()} came back as` +
        ` ${JSON.stringify(first?.[visitorColumn])}, which is not a number of` +
        ` visitors. A summary carrying zero here would read as a window` +
        ` nobody visited.`,
    );
  }

  return counted;
}
