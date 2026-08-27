// Reading the rows a successful query answered with.
//
// Apart from starting the query, because the two are different jobs and the
// paging here is most of the detail. Athena hands back a page at a time, with
// the column names in the first row of the first one.

import type * as Athena from "@aws-sdk/client-athena";

import type {
  AthenaClient,
  AthenaColumn,
  AthenaModule,
  AthenaOutcome,
} from "./athena-outcome.js";

/**
 * Every row a successful query answered with.
 *
 * Athena pages at a thousand rows and every page is followed, so a result
 * larger than one page comes back whole rather than truncated to its first
 * page without saying so. A query whose answer is too big to hold is one that
 * wanted a `LIMIT`.
 */
export async function allResults(
  client: AthenaClient,
  athena: AthenaModule,
  queryExecutionId: string,
  token?: string,
  columns?: readonly AthenaColumn[],
): Promise<Pick<AthenaOutcome, "columns" | "rows">> {
  const page = await client.send(
    new athena.GetQueryResultsCommand({
      QueryExecutionId: queryExecutionId,
      ...(token === undefined ? {} : { NextToken: token }),
    }),
  );

  const columnsHere = columns ?? columnsOf(page);

  const rows = dataRows(page, columnsHere, columns === undefined).map((cells) =>
    Object.fromEntries(
      columnsHere.map((column, index) => [column.name, cells[index]]),
    ),
  );

  if (page.NextToken === undefined) {
    return { columns: columnsHere, rows };
  }

  const rest = await allResults(
    client,
    athena,
    queryExecutionId,
    page.NextToken,
    columnsHere,
  );

  return { columns: columnsHere, rows: [...rows, ...rest.rows] };
}

/**
 * The columns one page says it carries.
 *
 * Read from the metadata rather than from the first row, since a statement
 * answering no rows still names its columns and an empty CSV still needs a
 * header.
 */
export function columnsOf(
  page: Athena.GetQueryResultsCommandOutput,
): readonly AthenaColumn[] {
  return (page.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map(
    (column) => ({ name: column.Name ?? "", type: column.Type }),
  );
}

/**
 * The data rows of one page.
 *
 * Athena puts the column names in the first row of the first page of a
 * `SELECT` result, and nowhere else. It is a header rather than data. A later
 * page whose first row happens to hold the column names is left alone, and so
 * is every statement type that carries no header.
 */
export function dataRows(
  page: Athena.GetQueryResultsCommandOutput,
  columns: readonly AthenaColumn[],
  isFirstPage: boolean,
): readonly (readonly (string | undefined)[])[] {
  const cells = (page.ResultSet?.Rows ?? []).map((row) =>
    (row.Data ?? []).map((datum) => datum.VarCharValue),
  );
  const first = cells.at(0);
  const isHeader =
    isFirstPage &&
    first !== undefined &&
    first.length === columns.length &&
    first.every((cell, index) => cell === columns[index]?.name);

  return isHeader ? cells.slice(1) : cells;
}
