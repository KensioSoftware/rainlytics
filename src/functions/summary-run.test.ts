import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

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
  const aPayload = (over: Readonly<Record<string, unknown>> = {}): unknown => ({
    question: { name: "pageviews", includeBots: false },
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
    expect(run.question.name).toBe("pageviews");
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

  it("refuses a question named something no key can carry", () => {
    // Given a payload naming a question with a space in it.
    const reading = (): unknown =>
      runFrom(aPayload({ question: { name: "Page Views" } }));

    // Then it is refused, because the key is built from that name.
    expect(reading).toThrow(/lowercase words/u);
  });
});
