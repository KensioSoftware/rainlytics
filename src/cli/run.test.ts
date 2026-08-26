import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { type Command, rainlyticsCommands } from "./command.js";
import { exitCodes } from "./failure.js";
import type { CliIo } from "./io.js";
import { runCli } from "./run.js";

describe("running a command line", () => {
  const aName = (): string =>
    faker.string.alpha({ length: 6, casing: "lower" });

  const aCommand = (over: Partial<Command> = {}): Command => ({
    name: aName(),
    summary: faker.lorem.sentence(),
    description: faker.lorem.paragraph(),
    run: () => ({ columns: [], rows: [] }),
    ...over,
  });

  /** A command that fails the test if anything runs it. */
  const neverRuns = (over: Partial<Command> = {}): Command =>
    aCommand({
      run: () => {
        throw new Error("this command should not have run");
      },
      ...over,
    });

  /** What a shell would have seen. */
  interface Ran {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  /**
   * Runs a command line against streams that write into memory.
   *
   * `outIsTerminal` is false unless a test says otherwise, which is what a
   * pipe and a CI runner both give.
   */
  const run = async (
    argv: readonly string[],
    commands: readonly Command[] = [],
    outIsTerminal = false,
  ): Promise<Ran> => {
    const out: string[] = [];
    const errors: string[] = [];

    const io: CliIo = {
      out: (text) => {
        out.push(text);
      },
      error: (text) => {
        errors.push(text);
      },
      outIsTerminal,
    };

    const code = await runCli({ argv, commands, io });

    return { code, stdout: out.join(""), stderr: errors.join("") };
  };

  describe("with no command named", () => {
    it("prints the help to standard output when it was asked for", async () => {
      // Given `rainlytics --help`, which asked for the help.
      const ran = await run(["--help"]);

      // Then the help is the result of the command. It can be piped into a
      // pager or a file like anything else, and the run succeeded.
      expect(ran.code).toBe(exitCodes.success);
      expect(ran.stdout).toContain("rainlytics <command> [options]");
      expect(ran.stderr).toBe("");
    });

    it("prints the help to standard error when nothing was asked for", async () => {
      // Given `rainlytics` on its own, which asked for nothing.
      const ran = await run([]);

      // Then the help is a diagnostic and standard output stays empty, so
      // `rainlytics | jq` is handed nothing rather than a page of prose shaped
      // like data. The exit says the line was wrong.
      expect(ran.code).toBe(exitCodes.usage);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain("rainlytics <command> [options]");
    });

    it("prints the version on its own line", async () => {
      // Given `rainlytics --version`.
      const ran = await run(["--version"]);

      // Then a bare version, which is what a script reading it expects.
      expect(ran.code).toBe(exitCodes.success);
      expect(ran.stdout).toMatch(/^\d+\.\d+\.\d+/u);
      expect(ran.stdout.endsWith("\n")).toBe(true);
    });

    it("says a command has to come before its options", async () => {
      // Given a line with the option first, which is how the AWS CLI is not
      // typed and how plenty of other tools are.
      const ran = await run(["--output", "json", "views"]);

      // Then it says what to do about it rather than reporting an unknown
      // flag, because `--output` is a flag and it does exist.
      expect(ran.code).toBe(exitCodes.usage);
      expect(ran.stderr).toContain("comes before its options");
      expect(ran.stderr).toContain("views");
    });

    it("refuses a command it does not have", async () => {
      // Given a name nothing answers to.
      const missing = aName();

      // When it is run against a CLI holding one other command.
      const ran = await run([missing], [aCommand()]);

      // Then the name that failed is in the message, and standard output
      // stays clean.
      expect(ran.code).toBe(exitCodes.usage);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain(missing);
      expect(ran.stderr).toContain('Run "rainlytics --help"');
    });
  });

  describe("with a command named", () => {
    const viewsOf = (path: string, views: number): Command =>
      aCommand({
        run: () => ({ columns: ["path", "views"], rows: [{ path, views }] }),
      });

    it("writes what the command found", async () => {
      // Given a command answering with one row.
      const path = `/${faker.word.noun()}`;
      const views = faker.number.int({ min: 1, max: 9999 });
      const command = viewsOf(path, views);

      // When it is run.
      const ran = await run([command.name], [command]);

      // Then the row is on standard output and the run succeeded.
      expect(ran.code).toBe(exitCodes.success);
      expect(ran.stdout).toContain(path);
      expect(ran.stdout).toContain(String(views));
    });

    it("gives a pipe JSON and a terminal the table", async () => {
      // Given the same command, run twice.
      const path = `/${faker.word.noun()}`;
      const views = faker.number.int({ min: 1, max: 9999 });
      const command = viewsOf(path, views);

      // When standard output is redirected, and when it is a terminal.
      const piped = await run([command.name], [command]);
      const terminal = await run([command.name], [command], true);

      // Then the pipe gets something that parses and the terminal gets
      // something aligned, with no flag passed either time.
      expect(JSON.parse(piped.stdout)).toStrictEqual([{ path, views }]);
      expect(terminal.stdout.split("\n")[1]).toMatch(/^-+ +-+$/u);
    });

    it("writes the format that was asked for", async () => {
      // Given a command run at a terminal, where the table is the default.
      const path = `/${faker.word.noun()}`;
      const views = faker.number.int({ min: 1, max: 9999 });
      const command = viewsOf(path, views);

      // When CSV is asked for anyway.
      const ran = await run([command.name, "--output", "csv"], [command], true);

      // Then the flag wins over what the streams imply.
      expect(ran.stdout).toBe(`path,views\n${path},${views}\n`);
    });

    it("refuses a format it cannot write", async () => {
      // Given a format nothing offers.
      const command = neverRuns();

      // When it is asked for.
      const ran = await run([command.name, "-o", "yaml"], [command]);

      // Then the run stops before the command does any work, and the message
      // lists what it would have taken.
      expect(ran.code).toBe(exitCodes.usage);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain("json, csv or table");
    });

    it("hands the command its arguments", async () => {
      // Given a command that answers with whatever it was given, as a query
      // command does with its SQL.
      const command = aCommand({
        run: ({ args }) => ({
          columns: ["given"],
          rows: args.map((given) => ({ given })),
        }),
      });
      const first = faker.word.noun();
      const second = faker.word.noun();

      // When two arguments follow the command name.
      const ran = await run([command.name, first, second], [command]);

      // Then both reach it, in order, with the command name removed.
      expect(JSON.parse(ran.stdout)).toStrictEqual([
        { given: first },
        { given: second },
      ]);
    });

    it("hands the command its own options", async () => {
      // Given a command declaring an option of its own.
      const command = aCommand({
        options: [
          {
            name: "since",
            type: "string",
            valueName: "date",
            description: faker.lorem.sentence(),
          },
        ],
        run: ({ options }) => ({
          columns: ["since"],
          rows: [{ since: String(options["since"]) }],
        }),
      });
      const since = faker.date.past().toISOString().slice(0, 10);

      // When it is given a value.
      const ran = await run([command.name, "--since", since], [command]);

      // Then the value reaches the command.
      expect(JSON.parse(ran.stdout)).toStrictEqual([{ since }]);
    });

    it("explains the command without running it", async () => {
      // Given a command that would fail if it ran.
      const command = neverRuns();

      // When its help is asked for.
      const ran = await run([command.name, "--help"], [command]);

      // Then the help is written and the command was never reached.
      expect(ran.code).toBe(exitCodes.success);
      expect(ran.stdout).toContain(`rainlytics ${command.name} [options]`);
    });

    it("points at the command's own help when the mistake was in its options", async () => {
      // Given an option no command declares.
      const command = neverRuns();

      // When it is passed after the command name.
      const ran = await run([command.name, `--${aName()}`], [command]);

      // Then the help offered is that command's, which is where the option
      // would have been listed.
      expect(ran.code).toBe(exitCodes.usage);
      expect(ran.stderr).toContain(`Run "rainlytics ${command.name} --help"`);
    });

    it("exits non-zero and says why when a command fails", async () => {
      // Given a command that fails the way an AWS call does, with a message
      // worth reading.
      const because = faker.lorem.sentence();
      const command = aCommand({
        run: () => {
          throw new Error(because);
        },
      });

      // When it is run.
      const ran = await run([command.name], [command]);

      // Then the shell sees a failure, the reason is on standard error, and
      // standard output carries nothing that could be mistaken for a result.
      expect(ran.code).toBe(exitCodes.failure);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain(because);
    });

    it("reports a failure that was not thrown as an Error", async () => {
      // Given a command that rejects with a string, which callback-era code
      // and some SDKs still do.
      const because = faker.lorem.sentence();
      const command = aCommand({
        run: () =>
          // The case under test is a failure that carries no `.message`, so
          // it has to be raised as the thing the rule forbids.
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors
          Promise.reject(because),
      });

      // When it is run.
      const ran = await run([command.name], [command]);

      // Then it still reports rather than crashing on a missing `.message`.
      expect(ran.code).toBe(exitCodes.failure);
      expect(ran.stderr).toContain(because);
    });

    it("waits for a command that takes its time", async () => {
      // Given a command that answers asynchronously, as every real one will.
      const path = `/${faker.word.noun()}`;
      const command = aCommand({
        run: async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 1);
          });

          return { columns: ["path"], rows: [{ path }] };
        },
      });

      // When it is run.
      const ran = await run([command.name], [command]);

      // Then the result is written, rather than an empty table going out
      // while the work is still in flight.
      expect(JSON.parse(ran.stdout)).toStrictEqual([{ path }]);
    });
  });

  describe("with the commands the binary ships", () => {
    it("explains itself", async () => {
      // Given the command list bin.ts hands the runner.
      const ran = await run(["--help"], rainlyticsCommands);

      // Then the help runs, and every command it ships is named in it. Empty
      // today, and this is what makes it wrong to add one silently.
      expect(ran.code).toBe(exitCodes.success);

      for (const command of rainlyticsCommands) {
        expect(ran.stdout).toContain(command.name);
      }
    });

    it("names each command once", () => {
      // Given the shipped commands.
      const names = rainlyticsCommands.map((command) => command.name);

      // Then no two answer to the same word, which would make one of them
      // unreachable.
      expect(new Set(names).size).toBe(names.length);
    });
  });
});
