// Turning completed calendar reports into one SNS plain-text message.

import { reportComparison } from "./report-comparisons.js";
import type { ReportComparison } from "./report-comparison-types.js";
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

  /**
   * `reportComparison` of `current` against `previous`. The publisher fills
   * it in whenever there is a previous report, and the default message
   * computes it where a caller left it out.
   */
  readonly comparison?: ReportComparison | undefined;
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

/**
 * The code that writes a notification, which a site can supply in place of
 * `reportNotificationMessage`. It may await reads of its own.
 */
export type ReportNotificationMessageFunction = (
  input: ReportNotificationMessageInput,
) => ReportNotificationMessage | Promise<ReportNotificationMessage>;

/** Summarises the current values and their adjacent-period changes. */
export function reportNotificationMessage(
  input: ReportNotificationMessageInput,
): ReportNotificationMessage {
  const subject = reportNotificationSubject(input);
  const lines = [
    subject,
    `Time zone: ${input.manifest.closingDay.timeZone}`,
    `Generated: ${input.manifest.createdAt}`,
  ];

  for (const report of input.reports) {
    lines.push("", ...reportNotificationReportLines(report, input));
  }

  return { subject, message: limitedReportNotificationMessage(lines) };
}

/** The default subject, naming the closed local day. */
export function reportNotificationSubject(
  input: Pick<ReportNotificationMessageInput, "manifest" | "subjectPrefix">,
): string {
  return `${input.subjectPrefix} reports through ${input.manifest.closingDay.startsOn}`;
}

/**
 * One report's block of the default message: its period heading, its source
 * object and every selected section with its comparison.
 */
export function reportNotificationReportLines(
  report: ReportNotificationReport,
  input: Pick<
    ReportNotificationMessageInput,
    "bucket" | "questions" | "maxRowsPerQuestion"
  >,
): readonly string[] {
  const { current, previous } = report;
  const selected =
    input.questions === undefined ? undefined : new Set(input.questions);
  const comparison =
    report.comparison ??
    (previous === undefined
      ? undefined
      : reportComparison({ current, previous }));
  const lines = [
    reportNotificationHeading(current),
    `Source: s3://${input.bucket}/${report.entry.key}`,
  ];
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
        input.maxRowsPerQuestion,
      ),
    );
  }

  if (included === 0) {
    lines.push("", "No configured questions were found in this report.");
  }

  return lines;
}
