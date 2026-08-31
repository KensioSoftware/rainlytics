// Validating the payload sent by a calendar report schedule.

import type { ReportWeekday } from "../report-periods.js";
import type { SummaryGranularity } from "../summary-windows.js";
import { summaryGranularities } from "../summary-windows.js";
import {
  reportInputRecord,
  reportInputRefusal,
} from "./report-input-validation.js";
import { reportQuestionFrom } from "./report-question-input.js";
import type { ReportRun } from "./report-run.js";

/** Reads and checks the payload a report schedule sent. */
export function reportRunFrom(payload: unknown): ReportRun {
  const found = reportInputRecord(payload);
  const timeZone = found["timeZone"];
  const weekStartsOn = found["weekStartsOn"];
  const recomputedDays = found["recomputedDays"];
  const granularities = found["granularities"];
  const questions = found["questions"];

  if (
    typeof timeZone !== "string" ||
    !isWeekday(weekStartsOn) ||
    !Number.isSafeInteger(recomputedDays) ||
    Number(recomputedDays) < 1 ||
    !Array.isArray(granularities) ||
    granularities.length === 0 ||
    !granularities.every((granularity) => isGranularity(granularity)) ||
    !Array.isArray(questions) ||
    questions.length === 0
  ) {
    throw reportInputRefusal(payload);
  }

  assertTimeZone(timeZone);

  return {
    timeZone,
    weekStartsOn,
    recomputedDays: Number(recomputedDays),
    granularities,
    questions: questions.map((question) => reportQuestionFrom(question)),
  };
}

const weekdays: ReadonlySet<ReportWeekday> = new Set([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

function isWeekday(value: unknown): value is ReportWeekday {
  return typeof value === "string" && weekdays.has(value as ReportWeekday);
}

function isGranularity(value: unknown): value is SummaryGranularity {
  return summaryGranularities.includes(value as SummaryGranularity);
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    throw new Error(
      `The report time zone ${JSON.stringify(timeZone)} is invalid.`,
    );
  }
}
