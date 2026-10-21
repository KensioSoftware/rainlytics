import {
  assertStringIncludes,
  assertStringNotIncludes,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { backfillPlanned, backfillProgressed } from "./backfill-report.js";
import type { BackfillRequest } from "./backfill-request.js";

describe("reporting a backfill on standard error", () => {
  const anHourlyBackfill: BackfillRequest = {
    question: "referrers",
    granularity: "hourly",
    range: {
      from: new Date("2026-09-11T00:00:00.000Z"),
      until: new Date("2026-10-12T00:00:00.000Z"),
    },
    schedule: "rainlytics-referrers-hourly",
    region: undefined,
  };

  it("counts one query a window for a question with no visitor count", () => {
    // Given a month of hours of a question that counts no visitors.
    // When the plan is written.
    const planned = backfillPlanned(anHourlyBackfill, 744, { sql: "SELECT" });

    // Then it is one query a window, at the 10 MB minimum each.
    assertStringIncludes(planned, "744 hourly window(s) of referrers");
    assertStringIncludes(planned, "744 Athena queries");
    assertStringIncludes(planned, "at least $0.04");
  });

  it("says where the next invocation carries on from", () => {
    // Given an invocation that wrote two hours and handed the rest on.
    // When its progress is written.
    const progressed = backfillProgressed({
      computed: ["2026-09-11T00:00:00.000Z", "2026-09-11T01:00:00.000Z"],
      next: {
        backfill: {
          from: "2026-09-11T02:00:00.000Z",
          until: "2026-10-12T00:00:00.000Z",
        },
      },
    });

    // Then it names both ends of what was written and where it goes next.
    assertStringIncludes(progressed, "2 window(s), 2026-09-11T00:00:00.000Z");
    assertStringIncludes(progressed, "Carrying on from 2026-09-11T02:00");
    assertStringNotIncludes(progressed, "done");
  });

  it("says so when an invocation wrote nothing", () => {
    // Given an invocation over a range with no closed windows left in it.
    // When its progress is written.
    const progressed = backfillProgressed({ computed: [] });

    // Then it says nothing was written and the range is done.
    assertStringIncludes(progressed, "Wrote no windows. The range is done.");
  });
});
