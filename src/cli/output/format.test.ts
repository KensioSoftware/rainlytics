import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { defaultOutputFormat, outputFormats, render } from "./format.js";
import type { CommandResult } from "./result.js";

describe("choosing an output format", () => {
  const aResult = (): CommandResult => ({
    columns: ["path", "views"],
    rows: [
      {
        path: `/${faker.word.noun()}`,
        views: faker.number.int({ min: 1, max: 9999 }),
      },
    ],
  });

  it("gives a program on the other end of a pipe JSON", () => {
    // Given a result, and standard output that is not a terminal.
    const result = aResult();

    // When it is written in whatever format that implies.
    const written = render(result, defaultOutputFormat(false));

    // Then it parses, so `rainlytics ... | jq` works with no flag passed.
    expect(JSON.parse(written)).toStrictEqual(result.rows);
  });

  it("gives a person at a terminal the aligned table", () => {
    // Given the same result, with standard output on a terminal.
    const result = aResult();

    // When it is written in whatever format that implies.
    const written = render(result, defaultOutputFormat(true));

    // Then it is the table, headed and ruled off rather than quoted and
    // braced.
    expect(written.split("\n")[1]).toMatch(/^-+ +-+$/u);
  });

  it("writes every format it says it accepts", () => {
    // Given the formats `--output` advertises.
    const result = aResult();

    // When each is rendered.
    // Then each produces something, and the three differ from one another. A
    // format that parsed and rendered as another one would be a flag that
    // quietly does nothing.
    const written = outputFormats.map((format) => render(result, format));
    expect(new Set(written).size).toBe(outputFormats.length);
  });

  it("carries the same data whichever format is asked for", () => {
    // Given a result with a value in every cell.
    const result = aResult();
    const value = String(result.rows[0]?.["path"]);

    // When each format is rendered.
    // Then the value is in all of them. The flag chooses a shape and never a
    // subset.
    for (const format of outputFormats) {
      expect(render(result, format)).toContain(value);
    }
  });
});
