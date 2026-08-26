import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { listOf } from "./text-layout.js";

describe("listing names in a sentence", () => {
  it("joins the last one with 'or'", () => {
    // Given three names, as `--output` has.
    // Then they read as a sentence would say them.
    expect(listOf(["json", "csv", "table"])).toBe("json, csv or table");
  });

  it("leaves one name alone", () => {
    // Given a single name.
    const only = faker.word.noun();

    // Then there is nothing to join it to.
    expect(listOf([only])).toBe(only);
  });
});
