// Turning completed calendar reports into one SNS plain-text message.

import { reportComparison } from "./report-comparisons.js";
import type {
  ReportNotificationManifest,
  ReportNotificationManifestEntry,
} from "./report-notification-manifest.js";
import type { ReportDocument } from "./report-document.js";
import { reportNotificationHeading } from "./report-notification-heading.js";
import {
  reportNotificationSectionHeading,
  reportNotificationSectionLines,
} from "./report-notification-section-lines.js";
import { limitedReportNotificationMessage } from "./report-notification-size.js";

/** A manifest entry and the report documents found for it. */
export interface ReportNotificationReport {
  readonly entry: ReportNotificationManifestEntry;
  readonly current: ReportDocument;
  readonly previous?: ReportDocument | undefined;
}

/** Input for one SNS subject and message. */
export interface ReportNotificationMessageInput {
  readonly manifest: ReportNotificationManifest;
  readonly bucket: string;
  readonly reports: readonly ReportNotificationReport[];
  readonly questions?: readonly string[] | undefined;
  readonly maxRowsPerQuestion: number;
  readonly subjectPrefix: string;
}

/** The text handed to SNS. */
export interface ReportNotificationMessage {
  readonly subject: string;
  readonly message: string;
}

/** Summarises the current values and their adjacent-period changes. */
export function reportNotificationMessage(
  input: ReportNotificationMessageInput,
): ReportNotificationMessage {
  const subject = `${input.subjectPrefix} reports through ${input.manifest.closingDay.startsOn}`;
  const lines = [
    subject,
    `Time zone: ${input.manifest.closingDay.timeZone}`,
    `Generated: ${input.manifest.createdAt}`,
  ];

  for (const report of input.reports) {
    lines.push(
      "",
      reportNotificationHeading(report.current),
      `Source: s3://${input.bucket}/${report.entry.key}`,
      ...reportLines(
        report.current,
        report.previous,
        input.questions,
        input.maxRowsPerQuestion,
      ),
    );
  }

  return { subject, message: limitedReportNotificationMessage(lines) };
}

/** One report's selected sections and comparison annotations. */
function reportLines(
  current: ReportDocument,
  previous: ReportDocument | undefined,
  questions: readonly string[] | undefined,
  maxRows: number,
): readonly string[] {
  const selected = questions === undefined ? undefined : new Set(questions);
  const comparison =
    previous === undefined
      ? undefined
      : reportComparison({ current, previous });
  const lines: string[] = [];
  let included = 0;

  if (previous === undefined) {
    lines.push("Comparison: no previous report was found.");
  }

  for (const [index, section] of current.sections.entries()) {
    if (selected !== undefined && !selected.has(section.question.name)) {
      continue;
    }

    included += 1;
    lines.push(
      "",
      reportNotificationSectionHeading(section),
      ...reportNotificationSectionLines(
        section,
        comparison?.sections[index],
        maxRows,
      ),
    );
  }

  if (included === 0) {
    lines.push("", "No configured questions were found in this report.");
  }

  return lines;
}
