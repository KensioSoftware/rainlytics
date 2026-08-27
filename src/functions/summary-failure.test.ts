import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import type { AthenaOutcome } from "../athena/athena-outcome.js";
import { summaryFailure } from "./summary-failure.js";

describe("reporting a query the job could not finish", () => {
  const anOutcome = (reason: string | undefined): AthenaOutcome => ({
    queryExecutionId: faker.string.uuid(),
    state: "FAILED",
    stateChangeReason: reason,
    bytesScanned: 10_000_000,
    milliseconds: faker.number.int(),
    region: "eu-west-2",
    columns: [],
    rows: [],
  });

  it("says what failed, why, and what it read on the way", () => {
    // Given a query Athena refused for a reason of its own.
    const outcome = anOutcome("SYNTAX_ERROR: line 1:8: Column 'nope' missing");

    // When the run reports it.
    const failure = summaryFailure(outcome, "pageviews for 08:00", "analytics");

    // Then the message names the question, Athena's reason, and the execution
    // somebody can go and look at. Nobody is watching a scheduled run, so it
    // has to explain itself to a reader arriving days later.
    expect(failure.message).toContain("pageviews for 08:00");
    expect(failure.message).toContain("Column 'nope' missing");
    expect(failure.message).toContain(outcome.queryExecutionId);
    expect(failure.message).toContain("10000000 bytes");
  });

  it("explains the bytes-scanned cutoff, which somebody chose", () => {
    // Given a query stopped by the workgroup's ceiling.
    const outcome = anOutcome(
      "Query exhausted resources: bytes scanned limit exceeded",
    );

    // When the run reports it.
    const failure = summaryFailure(outcome, "pageviews", "analytics");

    // Then it says whose ceiling that is and where it is set. The reason
    // Athena gives reads as a wall, and this is the one limit the pipeline
    // puts there deliberately.
    expect(failure.message).toContain("analytics workgroup's");
    expect(failure.message).toContain("bytesScannedCutoff");
  });

  it("reports a failure Athena gave no reason for", () => {
    // Given an execution that ended without a reason.
    const failure = summaryFailure(anOutcome(undefined), "searches", "queries");

    // Then the run still says which question stopped.
    expect(failure.message).toContain("searches");
    expect(failure.message).toContain("Athena gave no reason");
  });
});
