import { describe, expect, it } from "vitest";

import {
  currentMonth,
  defaultRedirectStatuses,
  rollupRequest,
} from "../rollups.js";
import { visitorSaltPlaceholder } from "../visitor-identity.js";
import { runFrom } from "./summary-run.js";

describe("what one firing of a schedule asks for", () => {
  const aQuestion = (): Readonly<Record<string, unknown>> => ({
    name: "pageviews",
    includeBots: false,
    limit: 20,
    param: "q",
    redirectStatuses: defaultRedirectStatuses,
  });

  const aPayload = (over: Readonly<Record<string, unknown>> = {}): unknown => ({
    question: aQuestion(),
    granularity: "hourly",
    sql: "SELECT 1\n",
    ...over,
  });

  it("is read out of the schedule's target input", () => {
    // Given the payload a schedule carries.
    const payload = aPayload();

    // When the job reads it.
    const run = runFrom(payload);

    // Then it has the question, the cadence and the SQL to run.
    expect(run.question).toStrictEqual(aQuestion());
    expect(run.granularity).toBe("hourly");
    expect(run.sql).toBe("SELECT 1\n");
  });

  it.each([
    ["nothing at all", undefined],
    ["a list", []],
    ["a window nobody stores", aPayload({ granularity: "weekly" })],
    ["a question with no name", aPayload({ question: {} })],
    ["a question that is not an object", aPayload({ question: "pageviews" })],
    ["no SQL", aPayload({ sql: 41 })],
  ])("refuses %s", (_what, payload) => {
    // Given a payload written by something other than the construct.
    const reading = (): unknown => runFrom(payload);

    // Then it is refused. A run that took it on trust would put a summary
    // under a key built from whatever it found.
    expect(reading).toThrow(/cannot read/u);
  });

  it("refuses a question short of a field a summary records", () => {
    // Given a payload whose question carries no row limit, which a summary's
    // document is meant to record.
    const withoutLimit = Object.fromEntries(
      Object.entries(aQuestion()).filter(([name]) => name !== "limit"),
    );
    const reading = (): unknown =>
      runFrom(aPayload({ question: withoutLimit }));

    // Then it is refused, rather than writing a summary describing a question
    // nobody asked. A reader comparing it against what they wanted would find
    // the field missing rather than different.
    expect(reading).toThrow(/limit/u);
  });

  it("asks for whatever fields a rollup request carries", () => {
    // Given a question carrying everything `rollupRequest` fills in.
    const complete = rollupRequest({ range: currentMonth });
    const named = Object.keys(complete).filter(
      (field) => field !== "dataset" && field !== "range",
    );

    // Then the payload built from those fields is accepted. The list is read
    // off the request rather than typed out, so a filter added to the
    // commands is asked for here without anybody remembering.
    const question = Object.fromEntries(
      named.map((field) => [field, complete[field as keyof typeof complete]]),
    );

    expect(() =>
      runFrom(aPayload({ question: { ...question, name: "searches" } })),
    ).not.toThrow();
  });

  it("carries the visitor count where the question asks for one", () => {
    // Given a schedule for a question that counts visitors.
    const visitorSql = `SELECT count(*)\n  WHERE ${visitorSaltPlaceholder}\n`;

    // Then the run has the second query to run beside the first.
    expect(runFrom(aPayload({ visitorSql })).visitorSql).toBe(visitorSql);
  });

  it("has none where the question counts something else", () => {
    // Given a schedule carrying one query.
    const run = runFrom(aPayload());

    // Then nothing counts visitors, and the summaries it writes carry no
    // `visitors` field at all.
    expect(run.visitorSql).toBeUndefined();
  });

  it("refuses a visitor count that is not SQL", () => {
    // Given a payload written by something other than the construct.
    const reading = (): unknown => runFrom(aPayload({ visitorSql: 41 }));

    // Then it is refused, rather than reaching Athena as the text "41".
    expect(reading).toThrow(/cannot read/u);
  });

  it("refuses a question named something no key can carry", () => {
    // Given a payload naming a question with a space in it.
    const reading = (): unknown =>
      runFrom(aPayload({ question: { ...aQuestion(), name: "Page Views" } }));

    // Then it is refused, because the key is built from that name.
    expect(reading).toThrow(/lowercase words/u);
  });
});
