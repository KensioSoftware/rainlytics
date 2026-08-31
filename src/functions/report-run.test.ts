import {
  assertIdentical,
  assertObjectEquals,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { defaultRedirectStatuses } from "../rollups.js";
import {
  reportQuestionRun,
  reportRunFrom,
  type ReportQuestionRun,
} from "./report-run.js";
import type { SummaryRun } from "./summary-run.js";

describe("what one firing of the report schedule asks for", () => {
  const aQuestion = () => ({
    name: "pageviews",
    includeBots: false,
    limit: 20,
    param: "q",
    redirectStatuses: defaultRedirectStatuses,
  });

  const aSummaryRun = (): SummaryRun => ({
    question: aQuestion(),
    granularity: "daily",
    sql: "SELECT 1\n",
    visitorSql: "SELECT 2\n",
  });

  const aReportQuestion = (
    over: Partial<ReportQuestionRun> = {},
  ): ReportQuestionRun => ({
    question: aQuestion(),
    sql: "SELECT 1\n",
    visitorSql: "SELECT 2\n",
    rule: "ranked",
    calculation: "summaries",
    totals: { added: ["views"] },
    ...over,
  });

  const aPayload = (over: Readonly<Record<string, unknown>> = {}): unknown => ({
    timeZone: "UTC",
    weekStartsOn: "monday",
    recomputedDays: 2,
    granularities: ["hourly", "daily"],
    questions: [aReportQuestion()],
    ...over,
  });

  it("serialises the arithmetic a rollup exposes", () => {
    // Given a summary run and addition rules.
    const run = aSummaryRun();

    // When its report question is built.
    const question = reportQuestionRun(run, "ranked", "summaries", {
      added: ["views"],
    });

    // Then the summary cadence is gone and the totals are plain data.
    assertObjectEquals(question, aReportQuestion());
  });

  it("leaves optional visitor SQL and totals out", () => {
    // Given a question calculated directly over its period.
    const summary = { ...aSummaryRun(), visitorSql: undefined };

    // When the report question is built without totals.
    const question = reportQuestionRun(summary, "percentile", "period-query");

    // Then its calculation carries no summary arithmetic.
    assertObjectEquals(question, {
      question: aQuestion(),
      sql: "SELECT 1\n",
      rule: "percentile",
      calculation: "period-query",
    });
  });

  it("reads the calendar and questions from the schedule input", () => {
    // Given a complete schedule payload.
    // When the report job reads it.
    const run = reportRunFrom(aPayload());

    // Then the calendar choices and question survive validation.
    assertIdentical(run.timeZone, "UTC");
    assertIdentical(run.weekStartsOn, "monday");
    assertIdentical(run.recomputedDays, 2);
    assertObjectEquals(run.questions, [aReportQuestion()]);
  });

  it.each([
    ["nothing", undefined],
    ["an unknown weekday", aPayload({ weekStartsOn: "workday" })],
    ["no closing days", aPayload({ recomputedDays: 0 })],
    ["no granularities", aPayload({ granularities: [] })],
    ["an unknown granularity", aPayload({ granularities: ["monthly"] })],
    ["no questions", aPayload({ questions: [] })],
    [
      "summary arithmetic with no totals",
      aPayload({ questions: [aReportQuestion({ totals: undefined })] }),
    ],
    [
      "invalid totals",
      aPayload({
        questions: [{ ...aReportQuestion(), totals: { added: ["views", 4] } }],
      }),
    ],
    [
      "an unknown composition rule",
      aPayload({ questions: [{ ...aReportQuestion(), rule: "median" }] }),
    ],
  ])("refuses %s", (_what, payload) => {
    // Given input ReportSchedule could not have written.
    // Then the report job refuses it before making AWS calls.
    const error = assertThrowsError(() => reportRunFrom(payload));
    assertStringMatches(error.message, /cannot read/u);
  });

  it("names an invalid IANA time zone", () => {
    // Given a payload naming no real calendar.
    // Then the refusal points at the time zone.
    const error = assertThrowsError(() =>
      reportRunFrom(aPayload({ timeZone: "Mars/Olympus_Mons" })),
    );
    assertStringMatches(error.message, /time zone/u);
  });
});
