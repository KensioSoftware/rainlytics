import {
  assertObjectEquals,
  assertStringIncludes,
  assertThrowsError,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { progressFrom } from "./backfill-answer.js";

describe("reading what one backfill invocation answered", () => {
  it("reads the windows and where to carry on", () => {
    // Given an answer from a function that can backfill.
    const body = JSON.stringify({
      computed: ["2026-09-11T00:00:00.000Z"],
      next: { backfill: { from: "2026-09-11T01:00:00.000Z" } },
    });

    // When it is read.
    // Then it comes back as it was sent.
    assertObjectEquals(progressFrom(body), JSON.parse(body));
  });

  it("names the redeploy when the function predates backfills", () => {
    for (const body of ["null", "{}", '{"computed":"none"}']) {
      // Given what a function deployed before backfills answers, or anything
      // else that carries no windows.
      // When it is read.
      const error = assertThrowsError(() => progressFrom(body));

      // Then the command says to deploy RollupSummaries first.
      assertStringIncludes(error.message, "Deploy RollupSummaries");
    }
  });
});
