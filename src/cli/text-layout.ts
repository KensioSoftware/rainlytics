// Laying text out for a terminal.
//
// Help is written here as whole sentences and wrapped at the last moment.
// Hand-wrapping it in the source would fix the width at whatever the source
// file was wrapped to, and every edit afterwards would mean rewrapping the
// paragraph by hand.

import { displayWidth, padToWidth } from "./display-width.js";

/** The column help is wrapped at, being a terminal nobody has widened. */
export const helpWidth = 78;

/** How far a list body is indented. */
export const indent = "  ";

/** `text` broken into lines no longer than `width`. */
export function wrapLines(text: string, width: number): readonly string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/u).filter((part) => part !== "")) {
    const candidate = line === "" ? word : `${line} ${word}`;

    if (displayWidth(candidate) > width && line !== "") {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line !== "") {
    lines.push(line);
  }

  return lines;
}

/** `text` wrapped to the help width, with no indent. */
export function paragraph(text: string): string {
  return wrapLines(text, helpWidth).join("\n");
}

/**
 * Several paragraphs of help, wrapped.
 *
 * Blank lines separate paragraphs and survive. A block whose first line is
 * indented is left exactly as it was written, which is what lets a command's
 * description carry an example somebody can copy. Wrapping one would join its
 * lines into a statement that no longer runs.
 */
export function prose(text: string): string {
  return text
    .split(/\n\s*\n/u)
    .map((block) =>
      /^\s/u.test(block) ? trimTrailing(block) : paragraph(block),
    )
    .filter((block) => block !== "")
    .join("\n\n");
}

/** A block with the whitespace at the end of each line taken off. */
function trimTrailing(block: string): string {
  return block
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replaceAll(/^\n+|\n+$/gu, "");
}

/** One entry in a two-column list. */
export interface LabelledEntry {
  /** The left column, being a command name or an option's spelling. */
  readonly label: string;

  /** The right column, which wraps under itself. */
  readonly description: string;
}

/** A two-column list, as the command and option lists both are. */
export function twoColumn(entries: readonly LabelledEntry[]): string {
  const width = Math.max(...entries.map((entry) => displayWidth(entry.label)));

  return entries
    .flatMap((entry) => {
      const gutter = `${indent}${padToWidth(entry.label, width)}${indent}`;
      const gutterWidth = displayWidth(gutter);
      const body = wrapLines(entry.description, helpWidth - gutterWidth);

      return body.map((line, index) =>
        index === 0 ? `${gutter}${line}` : `${" ".repeat(gutterWidth)}${line}`,
      );
    })
    .join("\n");
}

/** `text` wrapped and indented, as a list body with no label beside it. */
export function indented(text: string): string {
  return wrapLines(text, helpWidth - displayWidth(indent))
    .map((line) => `${indent}${line}`)
    .join("\n");
}

/** Joins names the way a sentence does, as `json, csv or table`. */
export function listOf(items: readonly string[]): string {
  const last = items.at(-1) ?? "";
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} or ${last}`
    : last;
}
