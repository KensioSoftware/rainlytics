import { assertObjectEquals } from "@kensio/smartass";
import type { GetQueryResultsCommandOutput } from "@aws-sdk/client-athena";
import { describe, it } from "vitest";

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
    assertObjectEquals(columnsOf(aPage([])), [
      { name: "path", type: "varchar" },
      { name: "views", type: "varchar" },
    ]);
  });

  it("names no columns where the page described none", () => {
    // Given a page with no metadata, which the SDK's types allow.
    assertObjectEquals(columnsOf({ $metadata: {} }), []);
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
    assertObjectEquals(dataRows(page, columnsOf(page), true), [["/", "2"]]);
  });

  it("keeps a first page whose first row is data", () => {
    // Given the first page of a statement Athena writes no header for, so
    // its first row is a row.
    const page = aPage([
      ["/", "2"],
      ["/liju/", "1"],
    ]);

    // Then nothing is dropped. The header is recognised by what it holds
    // rather than by where it sits, so a result without one keeps every row.
    assertObjectEquals(dataRows(page, columnsOf(page), true), [
      ["/", "2"],
      ["/liju/", "1"],
    ]);
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
    assertObjectEquals(dataRows(page, columnsOf(page), false), [
      ["path", "views"],
      ["/", "2"],
    ]);
  });

  it("reads a page holding no rows at all", () => {
    // Given a page with nothing in it, which is the second page of a result
    // whose first page held everything.
    assertObjectEquals(dataRows({ $metadata: {} }, [], true), []);
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
    assertObjectEquals(dataRows(page, [], false), [[]]);
  });
});
