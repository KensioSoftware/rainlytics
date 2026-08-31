// Shared refusals for invalid calendar report schedule input.

/** Reads an input object or refuses the report payload. */
export function reportInputRecord(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw reportInputRefusal(value);
  }

  return value as Readonly<Record<string, unknown>>;
}

/** The common message for input ReportSchedule could not have written. */
export function reportInputRefusal(payload: unknown): Error {
  return new Error(
    `The calendar report job was invoked with something it cannot read.` +
      ` RollupSummaries writes its time zone, week start, source windows and` +
      ` questions into the schedule. Got ${JSON.stringify(payload)}.`,
  );
}
