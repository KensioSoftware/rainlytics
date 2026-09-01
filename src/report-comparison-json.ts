// Structural equality for JSON-shaped report metadata.

// oxlint-disable-next-line unicorn/no-null
const absent = null;

/** Whether two JSON-shaped values have the same structure and values. */
export function sameReportValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** JSON text with object keys in a deterministic order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry));
  }

  if (typeof value !== "object" || value === absent) {
    return value;
  }

  const entries = Object.entries(value);
  // oxlint-disable-next-line unicorn/no-array-sort
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return Object.fromEntries(
    entries.map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}
