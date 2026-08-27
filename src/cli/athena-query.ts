// Running one query through Athena and waiting for it to finish.
//
// The SDK is loaded when a query is actually run, not when this module is
// imported. Two reasons, and the second is the one that would break a
// release. `rainlytics --help` should not pay to load a client it will never
// send with. And `scripts/sh/pack-check.sh` runs the packed CLI out of a
// tarball with no node_modules anywhere above it, so a static import here
// would turn `--help` into a "Cannot find module" for the check whose whole
// job is to catch that.

import type * as Athena from "@aws-sdk/client-athena";

import type {
  AthenaClient,
  AthenaModule,
  AthenaOutcome,
  AthenaQuery,
} from "./athena-outcome.js";
import { outcomeFrom } from "./athena-outcome.js";
import { refusalIn, resolvedRegion } from "./athena-region.js";
import { allResults } from "./athena-results.js";

/**
 * How long to wait before asking again whether a query has finished.
 *
 * `GetQueryExecution` is not charged for, so polling costs nothing but the
 * request. The first wait is short because a small query is often over
 * already, and the ceiling is low enough that a finished query is reported
 * promptly.
 */
const pollBackoff = { first: 25, factor: 2, longest: 1000 };

/**
 * Runs one query and answers with everything it produced.
 *
 * The whole lifecycle, since Athena has no synchronous form. Start, ask until
 * the execution settles, and read the rows back where it succeeded.
 *
 * A query that failed comes back described rather than thrown. What it
 * scanned on the way to failing is worth reporting, and the caller is what
 * knows how to explain the reason.
 *
 * The client is built for the region the query names, and left to the AWS
 * SDK's default chain where it names none. Whichever answered comes back on
 * the outcome, and on anything the client throws.
 */
export async function runAthenaQuery(
  query: AthenaQuery,
): Promise<AthenaOutcome> {
  const athena: AthenaModule = await import("@aws-sdk/client-athena");
  const client = new athena.AthenaClient(
    query.region === undefined ? {} : { region: query.region },
  );

  try {
    const started = await client.send(
      new athena.StartQueryExecutionCommand({
        QueryString: query.sql,
        QueryExecutionContext: { Database: query.database },
        WorkGroup: query.workgroup,
      }),
    );
    const queryExecutionId = started.QueryExecutionId ?? "";
    const settled = await settledExecution(
      client,
      athena,
      queryExecutionId,
      pollBackoff.first,
    );
    const execution = settled.QueryExecution;

    return outcomeFrom(
      queryExecutionId,
      execution,
      execution?.Status?.State === "SUCCEEDED"
        ? await allResults(client, athena, queryExecutionId)
        : { columns: [], rows: [] },
      await resolvedRegion(client),
    );
  } catch (error) {
    throw refusalIn(error, await resolvedRegion(client));
  } finally {
    client.destroy();
  }
}

/** Whether a query has stopped moving. */
function isSettled(state: Athena.QueryExecutionState | undefined): boolean {
  return state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED";
}

/**
 * The execution once it has finished, asked for again until it has.
 *
 * Written as a call rather than a loop, which is what keeps the wait between
 * asks in one place. A query Athena is still running recurses once per ask,
 * so a ten-minute one arrives about six hundred frames deep.
 */
async function settledExecution(
  client: AthenaClient,
  athena: AthenaModule,
  queryExecutionId: string,
  wait: number,
): Promise<Athena.GetQueryExecutionCommandOutput> {
  const described = await client.send(
    new athena.GetQueryExecutionCommand({
      QueryExecutionId: queryExecutionId,
    }),
  );

  if (isSettled(described.QueryExecution?.Status?.State)) {
    return described;
  }

  await sleep(wait);

  return settledExecution(
    client,
    athena,
    queryExecutionId,
    Math.min(wait * pollBackoff.factor, pollBackoff.longest),
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
