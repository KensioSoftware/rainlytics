import type { GetQueryResultsCommandOutput } from "@aws-sdk/client-athena";
import { describe, expect, it } from "vitest";

import { columnsOf, dataRows } from "./athena-results.js";

describe("reading one page of a result", () => {
  const aPage = (
    rows: readonly (readonly string[])[],
    columns: readonly string[] = ["path", "views"],
  ): GetQueryResultsCommandOutput => ({
    $metadata: {},
    ResultSet: {
      ResultSetMetadata: {
        ColumnInfo: columns.map((name) => ({ Name: name, Type: "varchar" })),
      },
      Rows: rows.map((cells) => ({
        Data: cells.map((value) => ({ VarCharValue: value })),
      })),
    },
  });

  it("names the columns from the metadata", () => {
    // Given a page describing its columns.
    // Then those are the columns, whatever the rows hold. A statement
    // answering nothing still names them, and an empty CSV still needs a
    // header.
    expect(columnsOf(aPage([]))).toStrictEqual([
      { name: "path", type: "varchar" },
      { name: "views", type: "varchar" },
    ]);
  });

  it("names no columns where the page described none", () => {
    // Given a page with no metadata, which the SDK's types allow.
    expect(columnsOf({ $metadata: {} })).toStrictEqual([]);
  });

  it("drops the header Athena puts on the first page", () => {
    // Given the first page of a SELECT, whose first row is the column names.
    const page = aPage([
      ["path", "views"],
      ["/", "2"],
    ]);

    // Then only the data comes back. Left in, the header would print as a
    // row saying "path" and "views", which reads as data in every one of the
    // three output formats.
    expect(dataRows(page, columnsOf(page), true)).toStrictEqual([["/", "2"]]);
  });

  it("keeps a later page's first row, whatever it holds", () => {
    // Given a second page whose first row happens to carry the column names,
    // because a site really does have a path called "path".
    const page = aPage([
      ["path", "views"],
      ["/", "2"],
    ]);

    // Then nothing is dropped. Athena writes the header once, on the first
    // page, and a row that looks like one anywhere else is a row.
    expect(dataRows(page, columnsOf(page), false)).toStrictEqual([
      ["path", "views"],
      ["/", "2"],
    ]);
  });

  it("reads a page holding no rows at all", () => {
    // Given a page with nothing in it, which is the second page of a result
    // whose first page held everything.
    expect(dataRows({ $metadata: {} }, [], true)).toStrictEqual([]);
  });

  it("reads a row shorter than the columns say", () => {
    // Given a row carrying no data, which is how Athena writes one whose
    // every column is null.
    const page: GetQueryResultsCommandOutput = {
      $metadata: {},
      ResultSet: { Rows: [{}] },
    };

    // Then it comes back as a row with no cells, rather than throwing on the
    // way past.
    expect(dataRows(page, [], false)).toStrictEqual([[]]);
  });
});
