// Report notification choices, filled in and checked at synthesis.

import type { ITopic } from "aws-cdk-lib/aws-sns";

import { type ReportPeriodUnit, reportPeriodUnits } from "../report-periods.js";

/** What report notifications need telling. */
export interface ReportNotificationsProps {
  /**
   * An SNS topic of the site's own. Rainlytics creates one when this is left
   * out and at least one email address is supplied.
   */
  readonly topic?: ITopic | undefined;

  /**
   * Email addresses to subscribe to the topic with SNS's plain-text email
   * protocol. Each address has to confirm its subscription.
   */
  readonly emails?: readonly string[] | undefined;

  /**
   * Calendar periods included when they close on the notification day.
   *
   * @default day, week, month and year
   */
  readonly periods?: readonly ReportPeriodUnit[] | undefined;

  /**
   * Question names included in each report. Leaving this out includes every
   * question in the report document.
   */
  readonly questions?: readonly string[] | undefined;

  /**
   * The most rows included from one question in the plain-text summary.
   *
   * @default 5
   */
  readonly maxRowsPerQuestion?: number | undefined;

  /**
   * The text before the closing date in the SNS subject.
   *
   * @default Rainlytics
   */
  readonly subjectPrefix?: string | undefined;
}

/** Report notification settings after defaults and validation. */
export interface ReportNotificationConfiguration {
  readonly topic?: ITopic | undefined;
  readonly emails: readonly string[];
  readonly periods: readonly ReportPeriodUnit[];
  readonly questions?: readonly string[] | undefined;
  readonly maxRowsPerQuestion: number;
  readonly subjectPrefix: string;
}

/** Fills and checks report notification settings. */
export function reportNotificationConfiguration(
  props: ReportNotificationsProps,
): ReportNotificationConfiguration {
  const emails = props.emails ?? [];
  const periods = props.periods ?? reportPeriodUnits;
  const maxRowsPerQuestion = props.maxRowsPerQuestion ?? 5;
  const subjectPrefix = props.subjectPrefix ?? "Rainlytics";

  if (props.topic === undefined && emails.length === 0) {
    throw new Error(
      "Report notifications need an SNS topic or at least one email address.",
    );
  }

  assertUniqueNonempty(emails, "email address");
  assertUniqueNonempty(props.questions ?? [], "report question");

  if (periods.length === 0) {
    throw new Error("Report notifications need at least one calendar period.");
  }

  const uniquePeriods = new Set(periods);
  if (uniquePeriods.size !== periods.length) {
    throw new Error("Report notification calendar periods must be unique.");
  }

  for (const period of periods) {
    if (!reportPeriodUnits.includes(period)) {
      throw new Error(
        `The report notification calendar period ${JSON.stringify(period)}` +
          ` is not supported.`,
      );
    }
  }

  if (
    !Number.isSafeInteger(maxRowsPerQuestion) ||
    maxRowsPerQuestion < 1 ||
    maxRowsPerQuestion > 100
  ) {
    throw new Error(
      "Report notifications include a whole number of rows per question," +
        ` from 1 to 100. Got ${String(maxRowsPerQuestion)}.`,
    );
  }

  if (
    subjectPrefix.length === 0 ||
    subjectPrefix.length > 70 ||
    hasControlCharacter(subjectPrefix)
  ) {
    throw new Error(
      "A report notification subject prefix must contain 1 to 70 characters" +
        " and no control characters.",
    );
  }

  return {
    ...(props.topic === undefined ? {} : { topic: props.topic }),
    emails,
    periods,
    ...(props.questions === undefined ? {} : { questions: props.questions }),
    maxRowsPerQuestion,
    subjectPrefix,
  };
}

/** Whether a string contains a character SNS refuses in a subject. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

/** Refuses blank or repeated string settings. */
function assertUniqueNonempty(
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
