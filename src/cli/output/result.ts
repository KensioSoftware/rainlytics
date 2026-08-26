// What a command answers with.
//
// Every answer is a table. Analytics questions have rows and columns, and one
// shape all three output formats can carry means a command says what it found
// once and the CLI writes it three ways.

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

/** One cell as text, for the two formats that have only text to write. */
export function cellText(cell: Cell): string {
  return cell === undefined || cell === null ? "" : String(cell);
}
