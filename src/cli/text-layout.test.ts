import { assertIdentical } from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { listOf } from "./text-layout.js";

describe("listing names in a sentence", () => {
  it("joins the last one with 'or'", () => {
    // Given three names, as `--output` has.
    // Then they read as a sentence would say them.
    assertIdentical(listOf(["json", "csv", "table"]), "json, csv or table");
  });

  it("leaves one name alone", () => {
    // Given a single name.
    const only = faker.word.noun();

    // Then there is nothing to join it to.
    assertIdentical(listOf([only]), only);
  });
});
