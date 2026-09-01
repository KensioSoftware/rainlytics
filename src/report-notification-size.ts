// Keeping a plain-text report notification under the SNS payload limit.

const maximumMessageBytes = 250_000;

/** Joins lines while leaving room under SNS's 256 KB message limit. */
export function limitedReportNotificationMessage(
  lines: readonly string[],
): string {
  const encoder = new TextEncoder();
  const kept: string[] = [];
  const omitted = "Message truncated at the SNS size limit.";

  for (const line of lines) {
    const candidate = [...kept, line, omitted].join("\n");
    if (encoder.encode(candidate).length > maximumMessageBytes) {
      kept.push(omitted);
      return kept.join("\n");
    }
    kept.push(line);
  }

  return kept.join("\n");
}
