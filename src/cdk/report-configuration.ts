// Calendar report choices, filled in and checked at synthesis.

import type { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Duration } from "aws-cdk-lib/core";

import {
  defaultReportWeekStartsOn,
  type ReportWeekday,
} from "../report-periods.js";
import { reportLagAfter } from "./report-lag.js";

/** The report settings accepted by RollupSummaries. */
export interface ReportConfigurationProps {
  /**
   * The IANA time zone whose days, weeks, months and years become reports.
   *
   * @default UTC
   */
  readonly reportTimeZone?: string | undefined;

  /**
   * The first weekday in calendar reports.
   *
   * @default Monday
   */
  readonly reportWeekStartsOn?: ReportWeekday | undefined;

  /**
   * How long after local midnight the report job runs.
   *
   * The default is at least fifteen minutes after the summary schedule. A
   * report can then read the daily summary that closed at the same boundary.
   */
  readonly reportLag?: Duration | undefined;

  /**
   * How many recently closed local days have their reports recomputed.
   *
   * @default two
   */
  readonly recomputedReportDays?: number | undefined;

  /**
   * How long one report run may take.
   *
   * @default fifteen minutes, being Lambda's maximum
   */
  readonly reportTimeout?: Duration | undefined;

  /** How long the report function's logs are kept. */
  readonly logRetention?: RetentionDays | undefined;
}

/** Report settings after every default and validation. */
export interface ReportConfiguration {
  readonly reportTimeZone: string;
  readonly reportWeekStartsOn: ReportWeekday;
  readonly reportLag: Duration;
  readonly recomputedReportDays: number;
}

/** Fills and checks report settings against the summary schedule. */
export function reportConfiguration(
  props: ReportConfigurationProps,
  summaryLag: Duration,
): ReportConfiguration {
  const reportLag = props.reportLag ?? reportLagAfter(summaryLag);
  const recomputedReportDays = props.recomputedReportDays ?? 2;

  if (!Number.isSafeInteger(recomputedReportDays) || recomputedReportDays < 1) {
    throw new Error(
      `A report run recomputes a whole number of closing days, at least one.` +
        ` Got ${String(recomputedReportDays)}.`,
    );
  }

  if (reportLag.toSeconds() <= summaryLag.toSeconds()) {
    throw new Error(
      `The report lag (${reportLag.toString()}) has to be later than the` +
        ` summary lag (${summaryLag.toString()}). A report reads summaries` +
        ` that close at the same boundary.`,
    );
  }

  return {
    reportTimeZone: canonicalTimeZone(props.reportTimeZone ?? "UTC"),
    reportWeekStartsOn: props.reportWeekStartsOn ?? defaultReportWeekStartsOn,
    reportLag,
    recomputedReportDays,
  };
}

/** Resolves aliases and refuses a time zone Scheduler cannot use. */
function canonicalTimeZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    throw new Error(
      `The report time zone ${JSON.stringify(timeZone)} is invalid.`,
    );
  }
}
