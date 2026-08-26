// The result as CSV, for a spreadsheet or for whatever reads one.

import { cellText, type CommandResult } from "./result.js";

/** The characters RFC 4180 says a field carrying them has to be quoted for. */
const needsQuoting = /[",\r\n]/u;

/** One field, quoted where the content calls for it. */
function escape(text: string): string {
  return needsQuoting.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The result as CSV, with a header row and a trailing newline.
 *
 * Lines end in LF where RFC 4180 asks for CRLF. Everything that reads this
 * accepts LF, and the tools it gets piped into on the way there are the ones
 * that mind CR.
 */
export function toCsv(result: CommandResult): string {
  const header = result.columns.map(escape);

  const rows = result.rows.map((row) =>
    result.columns.map((column) => escape(cellText(row[column]))),
  );

  return [header, ...rows].map((fields) => `${fields.join(",")}\n`).join("");
}
