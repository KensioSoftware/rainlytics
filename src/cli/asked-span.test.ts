import {
  assertIdentical,
  assertObjectEquals,
  assertStringIncludes,
} from "@kensio/smartass";
import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimAws, SimFixedClock } from "@kensio/yulin";
import { SimSdk } from "@kensio/yulin/sdk";
import { describe, it, vi } from "vitest";

import { conversionsOf } from "../conversion-rollup.js";
import type {
  RollupSummary,
  SummaryQuestion,
  SummaryRow,
} from "../rollup-summaries.js";
import { summaryKey, summarySchemaVersion } from "../rollup-summaries.js";
import { defaultRedirectStatuses } from "../rollups.js";
import { pageviews } from "../rollup-questions.js";
import type { SummaryWindow } from "../summary-windows.js";
import { summarySpan } from "../summary-windows.js";
import type { Command } from "./index.js";
import { rainlyticsCommands, rollupCommand, runCli } from "./index.js";
import { requestFrom } from "./rollup-options.js";

/*
 * Named questions read over the days somebody named, through the command line
 * a site gets from `@kensio/rainlytics/cli`.
 *
 * The summaries are put in the bucket by hand, as `summary-covering.test.ts`
 * puts them. What is under test is which windows a span reads, and a deployed
 * schedule would only compute the windows the clock has reached.
 */
describe("a span named by its days", () => {
  let intercepted: SimSdk | undefined;

  /** When the command runs in these cases. */
  const now = new Date("2026-08-24T09:16:00.000Z");

  /** A site's own conversion rate, which the executable does not ship. */
  const purchases = conversionsOf("purchase");

  /** What a site's own command line runs, being Rainlytics' and its own. */
  const siteCommands: readonly Command[] = [
    ...rainlyticsCommands,
    rollupCommand(purchases),
  ];

  /** A bucket in a simulated account, with the SDK pointed at it. */
  const aBucket = async () => {
    const bucket = `rainlytics-summaries-${faker.string.uuid()}`;
    const simAws = new SimAws({ clock: new SimFixedClock(now) });

    await simAws
      .region("us-east-1")
      .account()
      .s3()
      .createBucket({ input: { Bucket: bucket } });

    vi.useRealTimers();
    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(S3Client);
    vi.useFakeTimers({ toFake: ["Date"], now });

    return { bucket, simAws };
  };

  type Deployed = Awaited<ReturnType<typeof aBucket>>;

  /** The unfiltered question a schedule computes for one rollup. */
  const questionOf = (
    name: string,
    over: Partial<SummaryQuestion> = {},
  ): SummaryQuestion => ({
    name,
    includeBots: false,
    limit: 20,
    param: "q",
    redirectStatuses: defaultRedirectStatuses,
    ...over,
  });

  /** What one stored window holds, apart from its window. */
  type Stored = Pick<RollupSummary, "question" | "columns"> & {
    readonly rows: readonly SummaryRow[];
  };

  /** One stored day, as the job would have written it under its own key. */
  const putDay = async (
    deployed: Deployed,
    day: string,
    stored: Stored,
  ): Promise<void> => {
    await putWindow(
      deployed,
      { granularity: "daily", at: new Date(`${day}T12:00:00.000Z`) },
      stored,
    );
  };

  /** One stored window of either granularity. */
  const putWindow = async (
    deployed: Deployed,
    window: SummaryWindow,
    stored: Stored,
  ): Promise<void> => {
    const document: RollupSummary = {
      schemaVersion: summarySchemaVersion,
      window: summarySpan(window),
      computedAt: now.toISOString(),
      ...stored,
    };

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.bucket,
          Key: summaryKey(document.question, window),
          Body: JSON.stringify(document),
        },
      });
  };

  /** Stored conversion rates for one window. */
  const conversions = (converted: string): Stored => ({
    question: questionOf(purchases.name),
    columns: ["converted", "visitors", "converted_percent"],
    rows: [{ converted, visitors: "200", converted_percent: "1.5" }],
  });

  /** Stored conversion rates for one day. */
  const putConversions = async (
    deployed: Deployed,
    day: string,
    converted: string,
  ): Promise<void> => {
    await putDay(deployed, day, conversions(converted));
  };

  /** Runs a site's command line the way its own script would. */
  const cli = async (argv: readonly string[]) => {
    let out = "";
    let error = "";
    const code = await runCli({
      argv,
      commands: siteCommands,
      io: {
        out: (text) => {
          out += text;
        },
        error: (text) => {
          error += text;
        },
        outIsTerminal: false,
      },
    });

    return {
      code,
      out,
      error,
      rows: out.startsWith("[") ? JSON.parse(out) : [],
    };
  };

  it("reads one stored day of a site's own conversion rate", async () => {
    // Given two stored days of a conversion rate the executable does not
    // ship, which a site has added to its own command line.
    const deployed = await aBucket();
    await putConversions(deployed, "2026-08-22", "3");
    await putConversions(deployed, "2026-08-23", "7");

    // When one of the days is asked for.
    const run = await cli([
      purchases.name,
      "--day",
      "2026-08-22",
      "--summaries",
      deployed.bucket,
    ]);

    // Then that day's row is the answer, and the day either side of it is
    // left alone.
    assertIdentical(run.code, 0);
    assertObjectEquals(run.rows, [
      { converted: "3", visitors: "200", converted_percent: "1.5" },
    ]);
  });

  it("refuses the same question over a span of --last", async () => {
    // Given the same two stored days, and the hours of today that have
    // closed, which is what a deployment computing both granularities holds.
    const deployed = await aBucket();
    await putConversions(deployed, "2026-08-22", "3");
    await putConversions(deployed, "2026-08-23", "7");
    for (let hour = 0; hour < 9; hour += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await putWindow(
        deployed,
        {
          granularity: "hourly",
          at: new Date(Date.UTC(2026, 7, 24, hour, 30)),
        },
        conversions("1"),
      );
    }

    // When a span back from now is asked for instead.
    const run = await cli([
      purchases.name,
      "--last",
      "2d",
      "--summaries",
      deployed.bucket,
    ]);

    // Then it is refused, since no span ending now lands on one stored
    // window, and a distinct count over two windows does not add.
    assertIdentical(run.code, 1);
    assertStringIncludes(run.error, "answers over one stored window");
  });

  it("adds whole stored days between --from and --until", async () => {
    // Given three stored days of pageviews.
    const deployed = await aBucket();
    for (const [day, views] of [
      ["2026-08-21", "100"],
      ["2026-08-22", "3"],
      ["2026-08-23", "4"],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await putDay(deployed, day, {
        question: questionOf(pageviews.name),
        columns: ["path", "views"],
        rows: [{ path: "/", views }],
      });
    }

    // When the last two are asked for, --until being outside the span.
    const run = await cli([
      "pageviews",
      "--from",
      "2026-08-22",
      "--until",
      "2026-08-24",
      "--summaries",
      deployed.bucket,
    ]);

    // Then the two days are added and the one before them is left out.
    assertIdentical(run.code, 0);
    assertIdentical(Number(run.rows[0]?.views), 7);
  });

  it("reads a named day under a country the summary was narrowed to", async () => {
    // Given a stored day of pageviews computed for one country.
    const deployed = await aBucket();
    await putDay(deployed, "2026-08-22", {
      question: questionOf(pageviews.name, { countries: ["GB"] }),
      columns: ["path", "views"],
      rows: [{ path: "/", views: "5" }],
    });

    // When that day is asked for in that country, typed in lower case.
    const run = await cli([
      "pageviews",
      "--day",
      "2026-08-22",
      "--country",
      "gb",
      "--summaries",
      deployed.bucket,
    ]);

    // Then the narrowing and the day select the same stored window together.
    assertIdentical(run.code, 0);
    assertObjectEquals(run.rows, [{ path: "/", views: "5" }]);
  });

  it("carries the named day into a --query run", () => {
    // Given a command line naming a day.
    const options = { day: "2026-08-22", query: true };

    // When it is read as a request.
    const asked = requestFrom(
      {
        args: [],
        options,
        io: {
          out: () => undefined,
          error: () => undefined,
          outIsTerminal: false,
        },
      },
      pageviews,
    );

    // Then Athena is asked about that UTC day, midnight to midnight.
    assertObjectEquals(asked.request.range, {
      from: new Date("2026-08-22T00:00:00.000Z"),
      to: new Date("2026-08-23T00:00:00.000Z"),
    });
  });

  it("refuses a day given beside --last", async () => {
    // When a command line names its span two ways.
    const run = await cli(["pageviews", "--day", "2026-08-22", "--last", "7d"]);

    // Then it says which two, rather than quietly choosing one.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, "--last names the whole span");
    assertStringIncludes(run.error, "--day");
  });

  it("refuses a day the calendar does not have", async () => {
    // When the day is the thirtieth of February.
    const run = await cli(["pageviews", "--day", "2026-02-30"]);

    // Then it is refused before anything is read.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, "--day takes a UTC day as YYYY-MM-DD");
  });

  it("refuses an end with no start", async () => {
    // When only --until is given.
    const run = await cli(["pageviews", "--until", "2026-08-22"]);

    // Then the start is asked for.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, "--until needs --from");
  });

  it("refuses a span that ends before it starts", async () => {
    // When --until comes before --from.
    const run = await cli([
      "pageviews",
      "--from",
      "2026-08-22",
      "--until",
      "2026-08-21",
    ]);

    // Then both ends are named back.
    assertIdentical(run.code, 2);
    assertStringIncludes(run.error, "--from has to be earlier than --until");
  });

  it("lists a site's own question beside the shipped ones", async () => {
    // When the site's command line is asked what it answers.
    const run = await cli(["--help"]);

    // Then its own question is there, with its summary line.
    assertIdentical(run.code, 0);
    assertStringIncludes(run.out, purchases.name);
    assertStringIncludes(run.out, "pageviews");
  });
});
