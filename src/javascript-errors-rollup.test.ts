import { assertArrayNotIncludes, assertObjectEquals } from "@kensio/smartass";
import { describe, it } from "vitest";

import { javascriptErrors } from "./javascript-errors-rollup.js";
import { rollups } from "./rollup-questions.js";

describe("the JavaScript errors rollup", () => {
  it("waits for a deployment to opt in", () => {
    // Given the questions a deployment gets when it names none.
    // Then JavaScript errors is outside them. A site without error reporting
    // has no rows for this question and should pay for no scheduled query.
    assertArrayNotIncludes(rollups, javascriptErrors);
  });

  it("adds error counts from separate windows", () => {
    // Given an error count already reduced to one row for its window.
    // Then stored windows add their counts by the page and message beside it.
    assertObjectEquals(javascriptErrors.totals, { added: ["errors"] });
  });
});
