import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { UsageError } from "./failure.js";
import { parseCommandLine } from "./command-line.js";
import type { CliOption } from "./option.js";

describe("reading a command line", () => {
  const aName = (): string =>
    faker.string.alpha({ length: 8, casing: "lower" });

  const aStringOption = (name = aName()): CliOption => ({
    name,
    short: name.slice(0, 1),
    type: "string",
    description: faker.lorem.sentence(),
  });

  const aFlag = (name = aName()): CliOption => ({
    name,
    type: "boolean",
    description: faker.lorem.sentence(),
  });

  it("reads an option's value under its long name", () => {
    // Given an option that takes a value, and a value for it.
    const option = aStringOption();
    const value = faker.word.noun();

    // When the line spells the option out in full.
    const { values } = parseCommandLine([`--${option.name}`, value], [option]);

    // Then the value arrives under the long name.
    expect(values[option.name]).toBe(value);
  });

  it("reads the same option under its one-letter alias", () => {
    // Given the same option, given the short way.
    const option = aStringOption();
    const value = faker.word.noun();

    // When the line uses the alias.
    const { values } = parseCommandLine(
      [`-${option.short ?? ""}`, value],
      [option],
    );

    // Then it arrives under the long name, so nothing downstream has to know
    // which spelling was typed.
    expect(values[option.name]).toBe(value);
  });

  it("keeps everything that was not an option", () => {
    // Given a flag and two arguments of the kind a query takes.
    const flag = aFlag();
    const first = faker.word.noun();
    const second = faker.word.noun();

    // When they arrive mixed together.
    const { positionals } = parseCommandLine(
      [first, `--${flag.name}`, second],
      [flag],
    );

    // Then both arguments come back in the order they were typed.
    expect(positionals).toStrictEqual([first, second]);
  });

  it("refuses an option it has never heard of", () => {
    // Given a line naming an option nothing declares.
    const unknown = aName();

    // When it is read.
    const reading = (): unknown =>
      parseCommandLine([`--${unknown}`], [aFlag()]);

    // Then it is a usage error naming what was typed, which is what somebody
    // who has just made a typo is looking for.
    expect(reading).toThrow(UsageError);
    expect(reading).toThrow(unknown);
  });

  it("says nothing about how to pass a leading dash", () => {
    // Given the same unknown option. Node's parser follows its complaint with
    // a paragraph on quoting a positional that starts with a dash.
    const reading = (): unknown => parseCommandLine(["--wat"], [aFlag()]);

    // Then that paragraph is gone. It is advice for a different mistake, and
    // it arrives while somebody is looking for the name they got wrong.
    expect(reading).toThrow(/^Unknown option '--wat'\.$/u);
  });

  it("refuses an option left without its value", () => {
    // Given an option that takes a value, at the end of the line.
    const option = aStringOption();

    // When there is nothing after it.
    // Then it is a usage error rather than an option silently set to true.
    expect(() => parseCommandLine([`--${option.name}`], [option])).toThrow(
      UsageError,
    );
  });

  it("refuses a value the option does not offer", () => {
    // Given an option accepting one of a fixed set.
    const option: CliOption = {
      ...aStringOption(),
      choices: ["json", "csv", "table"],
    };

    // When something outside the set is asked for.
    const reading = (): unknown =>
      parseCommandLine([`--${option.name}`, "yaml"], [option]);

    // Then the refusal lists what it would have taken, so the next attempt is
    // the right one.
    expect(reading).toThrow(UsageError);
    expect(reading).toThrow("json, csv or table");
    expect(reading).toThrow("yaml");
  });

  it("accepts a value the option does offer", () => {
    // Given the same option and a value from its set.
    const option: CliOption = { ...aStringOption(), choices: ["json", "csv"] };

    // When one of them is asked for.
    const { values } = parseCommandLine([`--${option.name}`, "csv"], [option]);

    // Then it comes through.
    expect(values[option.name]).toBe("csv");
  });

  it("remembers which command a mistake was made in", () => {
    // Given a mistake made after a subcommand was named.
    const command = aName();

    // When the line is read on that command's behalf.
    let caught: unknown;
    try {
      parseCommandLine([`--${aName()}`], [aFlag()], command);
    } catch (error) {
      caught = error;
    }

    // Then the error carries the command, so the runner can point at the help
    // that would have explained it rather than at the root help.
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as UsageError).helpFor).toBe(command);
  });
});
