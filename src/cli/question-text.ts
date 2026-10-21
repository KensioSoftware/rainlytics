// Each counting filter of a question, as a sentence names it.
//
// Apart from `summary-question.ts`, which compares two questions through
// these. A filter compares equal when its text does, so the text is where a
// list read as a set gets sorted and a case-blind one gets folded.

/** The host a question counted, as a sentence names it. */
export function hostText(host: string | undefined): string {
  return host ?? "every host";
}

/** The sections a question counted, as a sentence names them. */
export function pathText(paths: readonly string[] | undefined): string {
  const named = paths ?? [];

  return named.length === 0 ? "the whole distribution" : named.join(" ");
}

/**
 * The countries a question counted, as a sentence names them.
 *
 * Sorted and each named once, since the list is a set. `GB IE` and `IE GB`
 * select the same rows, and comparing them as typed would refuse a summary
 * that answers the question. Paths keep their order, because the first of two
 * overlapping paths is the one `matchedPath` reports.
 */
export function countryText(countries: readonly string[] | undefined): string {
  return setText(countries ?? [], "every country");
}

/**
 * The substrings a question added to the bot filter, as a sentence names
 * them.
 *
 * A set like the countries, and folded to lower case as well, since the
 * filter ignores case. `GeedoShopProductFinder` leaves out the rows
 * `geedoshopproductfinder` does.
 */
export function botUserAgentText(
  agents: readonly string[] | undefined,
): string {
  return setText(
    (agents ?? []).map((agent) => agent.toLowerCase()),
    "the built-in four alone",
  );
}

/** A list read as a set, sorted and each value named once. */
function setText(values: readonly string[], none: string): string {
  // `toSorted` is ES2023 and the compiler targets ES2022, so the copy is
  // taken here and the sort runs over it.
  // oxlint-disable-next-line unicorn/no-array-sort
  const named = [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );

  return named.length === 0 ? none : named.join(" ");
}

/** Whether a question counted automated traffic, as a sentence says it. */
export function botText(includeBots: boolean): string {
  return includeBots ? "crawlers counted" : "crawlers left out";
}
