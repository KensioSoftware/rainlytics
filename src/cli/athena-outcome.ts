// What a query is, and what running one comes to.
//
// The vocabulary the three Athena modules share. Apart from them because a
// type both the caller and the reader of a result need is a poor fit for
// either one of them.

import type * as Athena from "@aws-sdk/client-athena";

/** The Athena SDK module, loaded when a query needs it. */
export type AthenaModule = typeof Athena;

/** An SDK client, as this module holds one. */
export type AthenaClient = Athena.AthenaClient;

/** What one query needs telling before it can run. */
export interface AthenaQuery {
  /** The SQL, as it will be sent. */
  readonly sql: string;

  /** The Glue database an unqualified table name is resolved against. */
  readonly database: string;

  /** The workgroup, which carries the cutoff and the results location. */
  readonly workgroup: string;
}

/** One column of a result, as Athena describes it. */
export interface AthenaColumn {
  /** The column's name, which is what the output is keyed by. */
  readonly name: string;

  /** The type Athena reports for it. */
  readonly type: string | undefined;
}

/** What running one query came to. */
export interface AthenaOutcome {
  /** The id, which is what finds this query again in the console. */
  readonly queryExecutionId: string;

  /** How it ended. */
  readonly state: Athena.QueryExecutionState | undefined;

  /** Why, where Athena said. */
  readonly stateChangeReason: string | undefined;

  /** How many bytes it scanned, which is what it is billed for. */
  readonly bytesScanned: number;

  /** How long Athena spent on it. */
  readonly milliseconds: number | undefined;

  /** The columns it answered with, in order. */
  readonly columns: readonly AthenaColumn[];

  /** The rows, each addressed by column name. */
  readonly rows: readonly Readonly<Record<string, string | undefined>>[];
}

/**
 * One outcome, assembled from what the SDK handed back.
 *
 * Every field Athena reports is optional in the SDK's types and present in
 * practice. The fallbacks are for the gap between those two, and a query id
 * of `""` or a scan of zero bytes is what a caller gets where the service
 * said less than its own shapes allow.
 */
export function outcomeFrom(
  queryExecutionId: string | undefined,
  execution: Athena.QueryExecution | undefined,
  results: Pick<AthenaOutcome, "columns" | "rows">,
): AthenaOutcome {
  return {
    queryExecutionId: queryExecutionId ?? "",
    state: execution?.Status?.State,
    stateChangeReason: execution?.Status?.StateChangeReason,
    bytesScanned: execution?.Statistics?.DataScannedInBytes ?? 0,
    milliseconds: execution?.Statistics?.TotalExecutionTimeInMillis,
    ...results,
  };
}
