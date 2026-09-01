// Formatting one report section for a plain-text notification.

import type { ReportSectionComparison } from "./report-comparison-types.js";
import { reportNotificationMetricLines } from "./report-notification-metric-lines.js";
import type { ReportSection } from "./report-section-types.js";

/** The question name plus the section traits a reader needs to notice. */
export function reportNotificationSectionHeading(
  section: ReportSection,
): string {
  const value =
    section.accuracy === "unavailable" ? undefined : section.value.type;
  const visitorSuffix = value === "visitor-count" ? " visitors" : "";
  const accuracySuffix =
    section.accuracy === "approximate" ? " (approximate)" : "";

  return `${section.question.name}${visitorSuffix}${accuracySuffix}`;
}

/** Current section values, with comparison changes where available. */
export function reportNotificationSectionLines(
  section: ReportSection,
  comparison: ReportSectionComparison | undefined,
  maxRows: number,
): readonly string[] {
  if (section.accuracy === "unavailable") {
    return [`  Unavailable: ${readableReason(section.reason)}.`];
  }

  if (comparison?.status === "available") {
    return reportNotificationMetricLines(comparison.metrics, maxRows);
  }

  const lines = rawValueLines(section, maxRows);
  if (comparison?.status === "unavailable") {
    lines.push(
      `  Comparison unavailable: ${readableReason(comparison.reason)}.`,
    );
  }
  return lines;
}

/** Current values where no comparison can safely be derived. */
function rawValueLines(
  section: Exclude<ReportSection, { readonly accuracy: "unavailable" }>,
  maxRows: number,
): string[] {
  if (section.value.type === "visitor-count") {
    return [`  distinct ${String(section.value.count.distinct)} visitors`];
  }

  const value = section.value;
  const rows = value.rows.slice(0, maxRows);
  const lines = rows.map(
    (row) =>
      `  ${value.columns
        .map((column) => `${column}=${String(row[column])}`)
        .join(", ")}`,
  );

  if (rows.length === 0) {
    lines.push("  No rows.");
  } else if (value.rows.length > rows.length) {
    lines.push(
      `  ${String(value.rows.length - rows.length)} more rows omitted.`,
    );
  }

  return lines;
}

/** Human-readable text for a stored machine reason. */
function readableReason(reason: string): string {
  return reason.replaceAll("-", " ");
}
