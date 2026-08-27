import { describe, expect, it } from "vitest";

import { outcomeFrom } from "./athena-outcome.js";

describe("what running a query came to", () => {
  const noResults = { columns: [], rows: [] };

  it("carries what Athena reported", () => {
    // Given a finished execution, as the SDK hands one back.
    const outcome = outcomeFrom(
      "abc-123",
      {
        Status: { State: "SUCCEEDED" },
        Statistics: {
          DataScannedInBytes: 4096,
          TotalExecutionTimeInMillis: 700,
        },
      },
      { columns: [{ name: "views", type: "bigint" }], rows: [{ views: "2" }] },
      "eu-west-1",
    );

    // Then every part of it survives, including the id that finds the query
    // again in the console.
    expect(outcome).toStrictEqual({
      queryExecutionId: "abc-123",
      region: "eu-west-1",
      state: "SUCCEEDED",
      stateChangeReason: undefined,
      bytesScanned: 4096,
      milliseconds: 700,
      columns: [{ name: "views", type: "bigint" }],
      rows: [{ views: "2" }],
    });
  });

  it("stands in for whatever Athena left out", () => {
    // Given an execution the SDK described with none of it. Every field is
    // optional in those types and present in practice, and this is the gap
    // between the two.
    const outcome = outcomeFrom(undefined, undefined, noResults, undefined);

    // Then the outcome is still usable. Nothing downstream has to ask
    // whether a byte count is a number before adding it up, and the scan
    // report says zero rather than throwing on a query that reported
    // nothing.
    expect(outcome.queryExecutionId).toBe("");
    expect(outcome.bytesScanned).toBe(0);
    expect(outcome.state).toBeUndefined();
    expect(outcome.milliseconds).toBeUndefined();
  });

  it("keeps the reason a query gave for stopping", () => {
    // Given a query Athena would not finish.
    const outcome = outcomeFrom(
      "abc-123",
      {
        Status: { State: "FAILED", StateChangeReason: "Table not found" },
        Statistics: { DataScannedInBytes: 0 },
      },
      noResults,
      "us-east-1",
    );

    // Then the reason comes through, which is the only thing the caller has
    // to explain the failure with.
    expect(outcome.state).toBe("FAILED");
    expect(outcome.stateChangeReason).toBe("Table not found");
  });
});
