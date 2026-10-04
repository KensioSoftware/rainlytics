// Checks on the strings report notification settings carry.

/** Whether a string contains a character SNS refuses in a subject. */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

/** Refuses blank or repeated string settings. */
export function assertUniqueNonempty(
  values: readonly string[],
  subject: string,
): void {
  const seen = new Set<string>();

  for (const value of values) {
    if (value.trim() === "") {
      throw new Error(`A report notification ${subject} cannot be blank.`);
    }

    if (seen.has(value)) {
      throw new Error(
        `The report notification ${subject} ${JSON.stringify(value)}` +
          " is repeated.",
      );
    }
    seen.add(value);
  }
}
