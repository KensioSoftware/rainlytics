import { assertIdentical, assertObjectEquals } from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { listOf, twoColumn, wrapLines } from "./text-layout.js";

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

describe("laying out terminal columns", () => {
  it("aligns descriptions after Chinese labels", () => {
    // Given labels with equal code-unit lengths and different terminal widths.
    const entries = [
      { label: "慣例", description: "customary practice" },
      { label: "ab", description: "two letters" },
    ];

    // When the entries are written in two columns.
    const output = twoColumn(entries);

    // Then both descriptions start in the same terminal column.
    assertIdentical(output, "  慣例  customary practice\n  ab    two letters");
  });

  it("wraps wide words at their displayed width", () => {
    // Given two Chinese characters followed by another word.
    const text = "慣例 next";

    // When the text is wrapped to four terminal columns.
    const lines = wrapLines(text, 4);

    // Then the second word starts a new line.
    assertObjectEquals(lines, ["慣例", "next"]);
  });

  it("keeps combining graphemes together when they fit", () => {
    // Given two decomposed accented letters occupying three columns with a gap.
    const text = "e\u0301 e\u0301";

    // When the text is wrapped to three terminal columns.
    const lines = wrapLines(text, 3);

    // Then both graphemes stay on one line.
    assertObjectEquals(lines, [text]);
  });
});
