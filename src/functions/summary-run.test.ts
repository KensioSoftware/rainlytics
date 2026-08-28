import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import {
  currentMonth,
  defaultRedirectStatuses,
  rollupRequest,
} from "../rollups.js";
import { deploymentFrom, runFrom, summaryEnvironment } from "./summary-run.js";

describe("where the job reads and writes", () => {
  const anEnvironment = (): Record<string, string> => ({
    [summaryEnvironment.database]: faker.word.noun(),
    [summaryEnvironment.workgroup]: faker.word.noun(),
    [summaryEnvironment.bucket]: faker.string.uuid(),
    [summaryEnvironment.windows]: "2",
  });

  it("is read out of the environment the construct set", () => {
    // Given a function deployed with everything it needs.
    const environment = anEnvironment();

    // When the job reads it.
    const deployment = deploymentFrom(environment);

    // Then it knows the table, the workgroup and the bucket.
    expect(deployment).toStrictEqual({
      database: environment[summaryEnvironment.database],
      workgroup: environment[summaryEnvironment.workgroup],
      bucket: environment[summaryEnvironment.bucket],
      windows: 2,
    });
  });

  it("refuses an invocation missing one of them", () => {
    // Given an environment with the bucket left out.
    const environment = Object.fromEntries(
      Object.entries(anEnvironment()).filter(
        ([name]) => name !== summaryEnvironment.bucket,
      ),
    );

    // When the job reads it.
    const reading = (): unknown => deploymentFrom(environment);

    // Then it says which variable was missing. A default here would write
    // summaries somewhere nobody reads, and the run would report success.
    expect(reading).toThrow(summaryEnvironment.bucket);
  });

  it("refuses a window count that is not a whole number of windows", () => {
    // Given a deployment whose window count was set to something else.
    const environment = {
      ...anEnvironment(),
      [summaryEnvironment.windows]: "two",
    };

    // When the job reads it.
    const reading = (): unknown => deploymentFrom(environment);

    // Then the message names the variable. Left to the window arithmetic, it
    // would be refused a moment later without saying where the value came
    // from, and a log nobody is watching has one chance to say so.
    expect(reading).toThrow(summaryEnvironment.windows);
    expect(reading).toThrow(/"two"/u);
  });

  it("refuses a variable that is there and empty", () => {
    // Given a bucket name set to nothing at all.
    const environment = { ...anEnvironment(), [summaryEnvironment.bucket]: "" };

    // Then it is refused like a missing one.
    expect(() => deploymentFrom(environment)).toThrow(
      summaryEnvironment.bucket,
    );
  });
});

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

  it("refuses a question named something no key can carry", () => {
    // Given a payload naming a question with a space in it.
    const reading = (): unknown =>
      runFrom(aPayload({ question: { ...aQuestion(), name: "Page Views" } }));

    // Then it is refused, because the key is built from that name.
    expect(reading).toThrow(/lowercase words/u);
  });
});
