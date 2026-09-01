// The result as an aligned table, which is what a person at a terminal reads.

import { displayWidth, padToWidth } from "../display-width.js";
import { cellText, type CommandResult } from "./result.js";

/** The gap between one column and the next. */
const gap = "  ";

/** The result as a table, with a header, a rule under it and no colour. */
export function toTable(result: CommandResult): string {
  const rows = result.rows.map((row) =>
    result.columns.map((column) => cellText(row[column])),
  );

  const widths = result.columns.map((column, index) =>
    Math.max(
      displayWidth(column),
      ...rows.map((cells) => displayWidth(cells[index] ?? "")),
    ),
  );

  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => padToWidth(cell, widths[index] ?? 0))
      .join(gap)
      .trimEnd();

  const rule = widths.map((width) => "-".repeat(width));

  return [result.columns, rule, ...rows]
    .map((cells) => `${line(cells)}\n`)
    .join("");
}
