import {
  assertIdentical,
  assertInstanceOf,
  assertObjectEquals,
  assertStringIncludes,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

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
    assertIdentical(values[option.name], value);
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
    assertIdentical(values[option.name], value);
  });

  it("collects an option that was told to gather its repeats", () => {
    // Given an option that collects, given twice.
    const option: CliOption = { ...aStringOption(), multiple: true };
    const first = faker.word.noun();
    const second = faker.word.noun();

    // When both are on the line.
    const { values } = parseCommandLine(
      [`--${option.name}`, first, `--${option.name}`, second],
      [option],
    );

    // Then both arrive, in the order they were typed. An ordinary option
    // keeps the last value, and the case below covers that.
    assertObjectEquals(values[option.name], [first, second]);
  });

  it("gathers one value into a list too", () => {
    // Given the same option, given once.
    const option: CliOption = { ...aStringOption(), multiple: true };
    const only = faker.word.noun();

    // When it is read.
    const { values } = parseCommandLine([`--${option.name}`, only], [option]);

    // Then it is still a list. Every reader downstream sees the same shape
    // whether the option was given once or twice. A shape that changed with
    // the count would put a branch in each of them.
    assertObjectEquals(values[option.name], [only]);
  });

  it("keeps the last value of an option that does not collect", () => {
    // Given an ordinary option, given twice.
    const option = aStringOption();
    const corrected = faker.word.noun();

    // When the line names it again.
    const { values } = parseCommandLine(
      [`--${option.name}`, faker.word.noun(), `--${option.name}`, corrected],
      [option],
    );

    // Then the last one wins. Somebody correcting a line they are still
    // typing expects that.
    assertIdentical(values[option.name], corrected);
  });

  it("holds every value of a collecting option to its choices", () => {
    // Given an option that collects one of a fixed set.
    const option: CliOption = {
      ...aStringOption(),
      multiple: true,
      choices: ["json", "csv"],
    };

    // When the second one is outside the set.
    const reading = (): unknown =>
      parseCommandLine(
        [`--${option.name}`, "json", `--${option.name}`, "yaml"],
        [option],
      );

    // Then it is refused and named. Checking only the first would let a
    // typo through on every occurrence after it.
    assertInstanceOf(assertThrowsError(reading), UsageError);
    {
      const error = assertThrowsError(reading);
      assertStringIncludes(error.message, "yaml");
    }
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
    assertObjectEquals(positionals, [first, second]);
  });

  it("refuses an option it has never heard of", () => {
    // Given a line naming an option nothing declares.
    const unknown = aName();

    // When it is read.
    const reading = (): unknown =>
      parseCommandLine([`--${unknown}`], [aFlag()]);

    // Then it is a usage error naming what was typed, which is what somebody
    // who has just made a typo is looking for.
    assertInstanceOf(assertThrowsError(reading), UsageError);
    {
      const error = assertThrowsError(reading);
      assertStringIncludes(error.message, unknown);
    }
  });

  it("says nothing about how to pass a leading dash", () => {
    // Given the same unknown option. Node's parser follows its complaint with
    // a paragraph on quoting a positional that starts with a dash.
    const reading = (): unknown => parseCommandLine(["--wat"], [aFlag()]);

    // Then that paragraph is gone. It is advice for a different mistake, and
    // it arrives while somebody is looking for the name they got wrong.
    {
      const error = assertThrowsError(reading);
      assertStringMatches(error.message, /^Unknown option '--wat'\.$/u);
    }
  });

  it("refuses an option left without its value", () => {
    // Given an option that takes a value, at the end of the line.
    const option = aStringOption();

    // When there is nothing after it.
    // Then it is a usage error rather than an option silently set to true.
    assertInstanceOf(
      assertThrowsError(() => parseCommandLine([`--${option.name}`], [option])),
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
    assertInstanceOf(assertThrowsError(reading), UsageError);
    {
      const error = assertThrowsError(reading);
      assertStringIncludes(error.message, "json, csv or table");
    }
    {
      const error = assertThrowsError(reading);
      assertStringIncludes(error.message, "yaml");
    }
  });

  it("accepts a value the option does offer", () => {
    // Given the same option and a value from its set.
    const option: CliOption = { ...aStringOption(), choices: ["json", "csv"] };

    // When one of them is asked for.
    const { values } = parseCommandLine([`--${option.name}`, "csv"], [option]);

    // Then it comes through.
    assertIdentical(values[option.name], "csv");
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
    assertInstanceOf(caught, UsageError);
    assertIdentical(caught.helpFor, command);
  });
});
