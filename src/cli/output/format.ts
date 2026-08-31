// The three shapes a result comes out in, and which one is picked when
// nobody says.

import {
  isJsonDocumentResult,
  type CommandOutput,
  type CommandResult,
} from "./result.js";
import { toCsv } from "./csv.js";
import { toJson, toJsonDocument } from "./json.js";
import { toTable } from "./table.js";

/** The formats `--output` accepts. */
export const outputFormats = ["json", "csv", "table"] as const;

/** One of the formats `--output` accepts. */
export type OutputFormat = (typeof outputFormats)[number];

const renderers: Readonly<
  Record<OutputFormat, (result: CommandResult) => string>
> = {
  json: toJson,
  csv: toCsv,
  table: toTable,
};

/**
 * The format to use when `--output` was left off.
 *
 * A person reading a terminal wants the table. A program reading a pipe wants
 * JSON, and asking for it every time would be a flag nobody could forget.
 * This is what makes `rainlytics ... | jq` work as typed.
 */
export function defaultOutputFormat(outIsTerminal: boolean): OutputFormat {
  return outIsTerminal ? "table" : "json";
}

/** The result written in one of the three formats. */
export function render(result: CommandOutput, format: OutputFormat): string {
  if (isJsonDocumentResult(result)) {
    return toJsonDocument(result.document);
  }

  return renderers[format](result);
}

/** The format `--output` asked for, or the one the streams imply. */
export function chosenFormat(
  asked: unknown,
  outIsTerminal: boolean,
): OutputFormat {
  return (
    outputFormats.find((format) => format === asked) ??
    defaultOutputFormat(outIsTerminal)
  );
}
