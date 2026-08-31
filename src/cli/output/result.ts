// What a command answers with.
//
// Analytics questions answer with rows and columns for the three tabular
// formats. A calendar report answers with its versioned JSON document.

/** One value in one row. */
export type Cell = string | number | boolean | null | undefined;

/** One row, addressed by column name. */
export type Row = Readonly<Record<string, Cell>>;

/**
 * The answer to one command.
 *
 * The columns are stated by the command. Deriving them from the rows would
 * leave a result with no rows carrying no header, and an empty CSV still
 * needs one. It would also hide a column that every row happens to leave
 * empty, which is usually the interesting thing about it.
 */
export interface CommandResult {
  /** The column names, in the order they are written. */
  readonly columns: readonly string[];

  /** The rows, in the order they are written. */
  readonly rows: readonly Row[];
}

/** A versioned JSON document that is already the command's public shape. */
export interface JsonDocumentResult {
  readonly kind: "json-document";

  /** The document written as JSON, without a row-array envelope. */
  readonly document: unknown;
}

/** One of the two result shapes a command can write. */
export type CommandOutput = CommandResult | JsonDocumentResult;

/** Whether a command answered with a JSON document. */
export function isJsonDocumentResult(
  result: CommandOutput,
): result is JsonDocumentResult {
  return "kind" in result;
}

/** One cell as text, for the two formats that have only text to write. */
export function cellText(cell: Cell): string {
  return cell === undefined || cell === null ? "" : String(cell);
}
