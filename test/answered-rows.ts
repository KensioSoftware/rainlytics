/**
 * Running a rollup's SQL against a seeded table and reading the rows back.
 *
 * Apart from `delivered-beacon-events.ts` because seeding a table and running
 * a query over it are two jobs. A case that only seeds never reaches this,
 * and a case asking about SQL wants the two checks below rather than a bucket
 * full of records.
 */

import type { DeployedBeaconTable } from "./delivered-beacon-events.js";
import { defaultLogDataset } from "../src/dataset.js";

/**
 * The rows one query answers with, run through the engine.
 *
 * Both checks below, because a query the engine declined still succeeds and
 * answers from a declaration. Rows a fixture happens to agree with look the
 * same as rows a query produced, and a rollup's arithmetic is the thing under
 * test.
 *
 * @throws {Error} where the query failed, or where something other than the
 *   engine answered it.
 */
export async function answeredRows(
  deployed: DeployedBeaconTable,
  sql: string,
): Promise<readonly (readonly (string | undefined)[])[]> {
  const athena = deployed.simAws.region("us-east-1").account().athena();
  const started = await athena.startQueryExecution({
    input: {
      QueryString: sql,
      QueryExecutionContext: { Database: defaultLogDataset.databaseName },
      ResultConfiguration: {
        OutputLocation: `s3://${deployed.resultsBucketName}/queries/`,
      },
    },
  });
  await deployed.simAws.backgroundTasksComplete();

  const id = started.QueryExecutionId ?? "";
  const execution = athena
    .queryExecutions()
    .find((each) => each.queryExecutionId === id);

  if (execution?.state !== "SUCCEEDED") {
    throw new Error(
      `The query did not succeed, so its rows prove nothing. ${
        execution?.stateChangeReason ?? "No reason was given."
      }`,
    );
  }

  if (execution.answeredBy !== "engine") {
    throw new Error(
      `The query was answered by a ${String(execution.answeredBy)} rather` +
        ` than run, so its rows prove nothing about the SQL.`,
    );
  }

  const results = await athena.getQueryResults({
    input: { QueryExecutionId: id },
  });

  return (results.ResultSet?.Rows ?? [])
    .slice(1)
    .map((row) => (row.Data ?? []).map((cell) => cell.VarCharValue));
}
