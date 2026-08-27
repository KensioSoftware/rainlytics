import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { pageviews, rollups, searches } from "../rollup-questions.js";
import type { Rollup } from "../rollups.js";
import {
  assertOneGranularity,
  assertOneSummaryEach,
  scheduleId,
} from "./summary-schedule-names.js";

describe("what a set of scheduled questions can be", () => {
  it("takes the questions Rainlytics ships", () => {
    // Given the shipped questions, each named once.
    // Then nothing is refused.
    expect(() => {
      assertOneSummaryEach(rollups);
    }).not.toThrow();
  });

  it("refuses two questions computed under one name", () => {
    // Given a site that wrote its own version of a shipped question and
    // passed both.
    const mine: Rollup = { ...pageviews, description: faker.lorem.sentence() };

    // When the pair is checked.
    const checking = (): void => {
      assertOneSummaryEach([...rollups, mine]);
    };

    // Then it is refused at synthesis, naming what would have happened. Both
    // would write to one key, and whichever ran last would be the answer.
    expect(checking).toThrow(/"pageviews"/u);
    expect(checking).toThrow(/same key/u);
  });

  it("refuses a deployment computing no windows", () => {
    // Given a deployment given an empty list of granularities.
    const checking = (): void => {
      assertOneGranularity([]);
    };

    // Then it is refused, rather than deploying a function nothing invokes.
    expect(checking).toThrow(/computes nothing/u);
  });
});

describe("what a schedule is called in the template", () => {
  it("names the question and the cadence", () => {
    // Given a run of a question whose name is hyphenated.
    const run = {
      question: { name: "cache-hit-ratio" },
      granularity: "hourly",
    } as never;

    // Then its logical id reads as both, in the case CDK expects. An id built
    // from a position in a list would renumber every schedule after one that
    // was added, and CloudFormation would replace resources nothing changed.
    expect(scheduleId(run)).toBe("CacheHitRatioHourly");
  });

  it("gives the two cadences of one question different ids", () => {
    // Given one question on both cadences.
    const ids = (["hourly", "daily"] as const).map((granularity) =>
      scheduleId({ question: { name: searches.name }, granularity } as never),
    );

    // Then they are two schedules and not one.
    expect(new Set(ids).size).toBe(2);
  });
});
