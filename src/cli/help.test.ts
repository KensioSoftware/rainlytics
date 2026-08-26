import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import type { Command } from "./command.js";
import { commandHelp, rootHelp } from "./help.js";
import type { CliOption } from "./option.js";

describe("the help text", () => {
  const aCommand = (over: Partial<Command> = {}): Command => ({
    name: faker.string.alpha({ length: 6, casing: "lower" }),
    summary: faker.lorem.sentence(),
    description: faker.lorem.paragraph(),
    run: () => ({ columns: [], rows: [] }),
    ...over,
  });

  /** What the help says once its own wrapping is undone. */
  const unwrapped = (help: string): string => help.replaceAll(/\s+/gu, " ");

  describe("for rainlytics itself", () => {
    it("names every command it can run, and says what each is for", () => {
      // Given two commands.
      const commands = [aCommand(), aCommand()];

      // When the root help is written.
      const help = unwrapped(rootHelp(commands));

      // Then each is listed with its summary. This list is the only place
      // somebody learns a command exists.
      for (const command of commands) {
        expect(help).toContain(command.name);
        expect(help).toContain(unwrapped(command.summary));
      }
    });

    it("says so when there is nothing to run yet", () => {
      // Given no commands, which is where this release stands.
      const help = rootHelp([]);

      // Then the section is still there and explains itself, rather than
      // leaving a heading with nothing under it.
      expect(help).toContain("Commands:");
      expect(unwrapped(help)).toContain("None yet.");
    });

    it("explains how it authenticates", () => {
      // Given the root help, which AGENTS.md asks to serve as the
      // documentation.
      const help = unwrapped(rootHelp([]));

      // Then it says where credentials come from. Somebody who has just run
      // this for the first time is asking what to log in with, and the answer
      // is that there is nothing to log in to.
      expect(help).toContain("AWS_PROFILE");
      expect(help).toContain("default credential chain");
    });

    it("explains what it writes and where", () => {
      // Given the root help.
      const help = unwrapped(rootHelp([]));

      // Then the output formats, the default, and the two streams are all in
      // it, because all three change what a pipeline sees.
      expect(help).toContain("--output");
      expect(help).toContain("standard error");
      expect(help).toContain("exits non-zero");
    });

    it("stays inside a narrow terminal", () => {
      // Given a root help with a command whose summary runs long.
      const help = rootHelp([aCommand({ summary: faker.lorem.paragraph() })]);

      // Then no line runs past 80 columns, which is what a terminal that has
      // not been widened gives.
      for (const line of help.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(80);
      }
    });
  });

  describe("for one command", () => {
    it("carries the command's own prose", () => {
      // Given a command with a summary and a description.
      const command = aCommand();

      // When its help is written.
      const help = unwrapped(commandHelp(command));

      // Then both are in it. The description is the documentation for the
      // command and there is nowhere else it is written down.
      expect(help).toContain(unwrapped(command.summary));
      expect(help).toContain(unwrapped(command.description));
    });

    it("shows how the command is typed", () => {
      // Given a command taking an argument, which says so itself.
      const usage = `rainlytics query "SELECT 1"`;
      const command = aCommand({ usage });

      // Then the usage line is the command's own.
      expect(commandHelp(command)).toContain(usage);
    });

    it("makes up a usage line for a command that takes no arguments", () => {
      // Given a command that says nothing about how it is typed.
      const command = aCommand();

      // Then one is derived from its name, so every command's help opens the
      // same way.
      expect(commandHelp(command)).toContain(
        `rainlytics ${command.name} [options]`,
      );
    });

    it("lists the command's own options beside the common ones", () => {
      // Given a command with an option of its own.
      const own: CliOption = {
        name: "since",
        type: "string",
        valueName: "date",
        description: faker.lorem.sentence(),
      };

      // When its help is written.
      const help = commandHelp(aCommand({ options: [own] }));

      // Then its option and the ones every command takes are all there.
      // Somebody reading one command's help should not need the root help
      // beside it.
      expect(help).toContain("--since <date>");
      expect(help).toContain("-o, --output <format>");
      expect(help).toContain("-h, --help");
    });

    it("names the value of an option that never said what to call it", () => {
      // Given an option taking a value and no name for it.
      const option: CliOption = {
        name: "region",
        type: "string",
        description: faker.lorem.sentence(),
      };

      // Then help still shows that it takes one.
      expect(commandHelp(aCommand({ options: [option] }))).toContain(
        "--region <value>",
      );
    });

    it("stays inside a narrow terminal", () => {
      // Given a command whose description is several paragraphs.
      const command = aCommand({ description: faker.lorem.paragraphs(3) });

      // Then nothing wraps past 80 columns.
      for (const line of commandHelp(command).split("\n")) {
        expect(line.length).toBeLessThanOrEqual(80);
      }
    });
  });
});
