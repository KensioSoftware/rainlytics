import {
  assertArrayNotIncludes,
  assertIdentical,
  assertUndefined,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { rollups } from "./rollup-questions.js";
import { webVitals, webVitalsPercentile } from "./web-vitals-rollup.js";

describe("the Web Vitals rollup", () => {
  it("waits for a deployment to opt in", () => {
    // Given the questions a deployment gets when it names none.
    // Then Web Vitals is outside them. A site without a beacon has no rows
    // for this question and should pay for no scheduled query over them.
    assertArrayNotIncludes(rollups, webVitals);
  });

  it("uses the percentile the thresholds are defined against", () => {
    // Given the percentile the rollup asks Athena for.
    // Then it is p75, as a proportion between zero and one.
    assertIdentical(webVitalsPercentile, 0.75);
  });

  it("leaves percentiles from separate windows apart", () => {
    // Given a percentile already reduced to one value for its window.
    // Then the rollup declares no arithmetic for combining it with another.
    // Averaging or weighting two p75 values does not produce their joint p75.
    assertUndefined(webVitals.totals);
  });
});
