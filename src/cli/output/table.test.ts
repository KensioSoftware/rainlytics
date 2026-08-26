import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { toTable } from "./table.js";

describe("table output", () => {
  const linesOf = (table: string): readonly string[] =>
    table.split("\n").filter((line) => line !== "");

  /**
   * Where the last column starts.
   *
   * The lines carry no trailing padding, so the last cell's start is the
   * line's length less that cell's own length. Read without asking the code
   * under test how wide it made anything.
   */
  const lastColumnStart = (line: string): number => {
    const cells = line.split(/\s{2,}/u);
    return line.length - (cells.at(-1) ?? "").length;
  };

  it("lines the columns up under their headings", () => {
    // Given two paths of very different lengths.
    const rows = [
      { path: "/", views: faker.number.int({ min: 1, max: 9 }) },
      {
        path: `/${faker.string.alpha({ length: 30, casing: "lower" })}`,
        views: faker.number.int({ min: 1000, max: 9999 }),
      },
    ];

    // When the result is written as a table.
    const table = toTable({ columns: ["path", "views"], rows });

    // Then every line starts its second column in the same place, which is
    // the whole reason a person at a terminal gets this format.
    const starts = linesOf(table).map((line) => lastColumnStart(line));
    expect(new Set(starts).size).toBe(1);
  });

  it("rules the heading off from the rows", () => {
    // Given a result with one row.
    const path = `/${faker.word.noun()}`;

    // When it is written.
    const [heading, rule, row] = linesOf(
      toTable({ columns: ["path"], rows: [{ path }] }),
    );

    // Then the heading, a rule as wide as the column, and the row.
    expect(heading).toBe("path");
    expect(rule).toBe("-".repeat(path.length));
    expect(row).toBe(path);
  });

  it("leaves no trailing spaces on a line", () => {
    // Given rows of uneven width, which is what padding exists for.
    const rows = [
      {
        path: `/${faker.string.alpha({ length: 20, casing: "lower" })}`,
        views: 1,
      },
      { path: "/", views: faker.number.int({ min: 10, max: 99 }) },
    ];

    // When the table is written.
    const table = toTable({ columns: ["path", "views"], rows });

    // Then nothing carries invisible whitespace to the end of the line, which
    // a diff, a copy and a paste into anything else all pick up.
    for (const line of linesOf(table)) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("shows an empty cell as a gap rather than as a word", () => {
    // Given a row missing one of the columns.
    const path = `/${faker.word.noun()}`;

    // When it is written.
    const table = toTable({
      columns: ["path", "referrer"],
      rows: [{ path }],
    });

    // Then nothing spells the absence out. "undefined" in a column is a
    // reading of the data nobody meant.
    expect(table).not.toContain("undefined");
    expect(table).not.toContain("null");
    expect(linesOf(table).at(-1)).toBe(path);
  });

  it("widens a column its heading is wider than its values", () => {
    // Given a count column whose values are all shorter than the word.
    const views = faker.number.int({ min: 1, max: 9 });

    // When it is written.
    const [, rule] = linesOf(
      toTable({ columns: ["views"], rows: [{ views }] }),
    );

    // Then the column is as wide as the heading, and the rule says so.
    expect(rule).toBe("-----");
  });
});
