// Measuring and padding text the way a terminal displays it.

import stringWidth from "string-width";

/** The number of terminal columns occupied by `text`. */
export function displayWidth(text: string): number {
  return stringWidth(text);
}

/** `text` padded on the right to occupy at least `width` terminal columns. */
export function padToWidth(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}
