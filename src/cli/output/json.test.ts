import {
  assertIdentical,
  assertObjectEquals,
  assertStringEndsWith,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { toJson, toJsonDocument } from "./json.js";

describe("JSON output", () => {
  const aRow = (): Readonly<Record<string, string | number>> => ({
    path: `/${faker.word.noun()}`,
    views: faker.number.int({ min: 1, max: 9999 }),
  });

  it("writes the rows as an array of objects", () => {
    // Given a result of two rows.
    const rows = [aRow(), aRow()];

    // When it is written as JSON and read back.
    const parsed: unknown = JSON.parse(
      toJson({ columns: ["path", "views"], rows }),
    );

    // Then it is the rows themselves, with no envelope around them. `jq
    // '.[0].path'` is the expression people already know, and a wrapper would
    // put a key in front of every one anybody writes.
    assertObjectEquals(parsed, rows);
  });

  it("gives every object every column", () => {
    // Given two rows where one is missing a value the other has.
    const complete = aRow();

    // When they are written together.
    const parsed = JSON.parse(
      toJson({
        columns: ["path", "views"],
        rows: [complete, { path: `/${faker.word.noun()}` }],
      }),
    ) as readonly Readonly<Record<string, unknown>>[];

    // Then the gap is an explicit null. A key that appears in some objects
    // and vanishes from others makes every reader of the output special-case
    // it.
    assertObjectEquals(Object.keys(parsed[1] ?? {}), ["path", "views"]);
    assertIdentical(parsed[1]?.["views"], null);
  });

  it("orders the keys the way the columns are ordered", () => {
    // Given a row written with its keys the other way round.
    const row = aRow();

    // When it is written against the columns in their own order.
    const parsed = JSON.parse(
      toJson({
        columns: ["views", "path"],
        rows: [{ path: row["path"], views: row["views"] }],
      }),
    ) as readonly Readonly<Record<string, unknown>>[];

    // Then the columns decide, so two runs of the same command produce the
    // same bytes for the same data.
    assertObjectEquals(Object.keys(parsed[0] ?? {}), ["views", "path"]);
  });

  it("ends in a newline", () => {
    // Given any result.
    // When it is written.
    const json = toJson({ columns: ["path"], rows: [aRow()] });

    // Then a shell prompt lands on a line of its own.
    assertStringEndsWith(json, "\n");
  });

  it("preserves a versioned document without a row-array envelope", () => {
    // Given a report-shaped document whose metadata is part of its result.
    const document = {
      schemaVersion: 1,
      period: { unit: "month", startsOn: "2026-08-01" },
      sections: [{ accuracy: "exact", value: { views: 42 } }],
    };

    // When it is written as a document result and read back.
    const parsed: unknown = JSON.parse(toJsonDocument(document));

    // Then the versioned document is the root JSON value.
    assertObjectEquals(parsed, document);
  });
});
