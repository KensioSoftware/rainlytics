import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimAws, SimFixedClock } from "@kensio/yulin";
import { SimSdk } from "@kensio/yulin/sdk";
import { describe, expect, it, vi } from "vitest";

import type { RollupSummary, SummaryRow } from "../rollup-summaries.js";
import { summaryKey, summarySchemaVersion } from "../rollup-summaries.js";
import type { Rollup } from "../rollups.js";
import { defaultRedirectStatuses, rollupRequest } from "../rollups.js";
import { pageviews } from "../rollup-questions.js";
import { defaultLogDataset } from "../dataset.js";
import type { SummaryWindow } from "../summary-windows.js";
import { summarySpan } from "../summary-windows.js";
import { rainlyticsCommands } from "./command.js";
import { runCli } from "./run.js";
import { summaryRows } from "./summary-answer.js";

/*
 * A bucket of summaries put there by hand, and the command line reading it.
 *
 * `summary-answer.test.ts` covers the ordinary path, where the deployed
 * schedule computes what the command then reads. These cases are the awkward
 * states a schedule cannot easily be made to produce: a day whose own run
 * failed, a hole between two windows, a summary from last week, and a question
 * narrowed differently from the one somebody typed.
 */
describe("reading a bucket of summaries", () => {
  let intercepted: SimSdk | undefined;

  /** When the command runs in these cases. */
  const now = new Date("2026-08-24T09:16:00.000Z");

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

  /** The question the shipped pageviews schedules compute. */
  const question = {
    name: pageviews.name,
    includeBots: false,
    limit: 20,
    param: "q",
    redirectStatuses: defaultRedirectStatuses,
  };

  /** One summary, as the job would have written it under its own key. */
  const putSummary = async (
    deployed: Deployed,
    window: SummaryWindow,
    rows: readonly SummaryRow[],
    over: Partial<RollupSummary> = {},
  ): Promise<void> => {
    const document: RollupSummary = {
      schemaVersion: summarySchemaVersion,
      question,
      window: summarySpan(window),
      computedAt: new Date(now.getTime() - 60_000).toISOString(),
      columns: ["path", "views"],
      rows,
      ...over,
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

  /** One hourly window of the day before the command runs. */
  const anHourOn = (day: string, hour: number): SummaryWindow => ({
    granularity: "hourly",
    at: new Date(`${day}T${String(hour).padStart(2, "0")}:30:00.000Z`),
  });

  /** Runs the CLI the way the executable does, and reads both streams. */
  const cli = async (argv: readonly string[]) => {
    let out = "";
    let error = "";
    const code = await runCli({
      argv,
      commands: rainlyticsCommands,
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

    return { code, out, error, rows: out === "" ? [] : JSON.parse(out) };
  };

  it("assembles a day nobody computed out of its hours", async () => {
    // Given the 24 hours of a day and no daily summary for it, which is what
    // a deployment computing hours alone leaves in the bucket. One page was
    // looked at once an hour and another twice in the evening.
    const deployed = await aBucket();

    for (let hour = 0; hour < 24; hour += 1) {
      // Sequential because each write goes to its own key and the assertion
      // is about all 24 of them being there.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await putSummary(deployed, anHourOn("2026-08-23", hour), [
        { path: "/", views: "1" },
        ...(hour === 20 ? [{ path: "/liju/", views: "2" }] : []),
      ]);
    }

    // When a span covering that whole day is asked for.
    const run = await cli([
      "pageviews",
      "--last",
      "34h",
      "--summaries",
      deployed.bucket,
    ]);

    // Then the day is answered from the hours under it. That is the second
    // reason hourly windows are stored, and it is what keeps a deployment
    // computing hours alone readable over a range longer than a day.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      { path: "/", views: "24" },
      { path: "/liju/", views: "2" },
    ]);
  });

  it("stops at a window missing from the middle of the span", async () => {
    // Given three hours in which the middle one was never computed, which is
    // what a run that failed leaves behind.
    const deployed = await aBucket();
    await putSummary(deployed, anHourOn("2026-08-24", 6), [
      { path: "/", views: "1" },
    ]);
    await putSummary(deployed, anHourOn("2026-08-24", 8), [
      { path: "/", views: "1" },
    ]);

    // When all three are asked about.
    const run = await cli([
      "pageviews",
      "--last",
      "4h",
      "--summaries",
      deployed.bucket,
    ]);

    // Then it names the missing window and stops. An answer skipping it
    // would be short by a whole hour with nothing in the rows to say so.
    expect(run.code).toBe(1);
    expect(run.error).toContain("2026-08-24T07:00:00.000Z");
    expect(run.error).toContain("--query");
  });

  it("reports the windows at the ends that have no summary", async () => {
    // Given a deployment that started computing an hour ago, so the older
    // windows of the span were never written.
    const deployed = await aBucket();
    await putSummary(deployed, anHourOn("2026-08-24", 8), [
      { path: "/", views: "4" },
    ]);

    // When four hours back are asked for.
    const run = await cli([
      "pageviews",
      "--last",
      "4h",
      "--summaries",
      deployed.bucket,
    ]);

    // Then the answer covers the hour that exists and standard error says
    // how many windows of the span it did not reach.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([{ path: "/", views: "4" }]);
    expect(run.error).toContain("2 windows in the range asked for");
    expect(run.error).toContain("--query");
  });

  it("names one missing window in the singular", async () => {
    // Given two hours in the span and only the newer one computed.
    const deployed = await aBucket();
    await putSummary(deployed, anHourOn("2026-08-24", 8), [
      { path: "/", views: "1" },
    ]);

    // When both are asked about, in the region the bucket is in.
    const run = await cli([
      "pageviews",
      "--last",
      "3h",
      "--region",
      "us-east-1",
      "--summaries",
      deployed.bucket,
    ]);

    // Then the line reads as English. "1 windows" is a line nobody
    // proofread, and this one is printed on every short read.
    expect(run.code).toBe(0);
    expect(run.error).toContain("1 window in the range asked for has");
  });

  it("names a bot filter the stored summaries were not computed with", async () => {
    // Given a summary computed with crawlers left out, which is the default
    // every schedule takes.
    const deployed = await aBucket();
    await putSummary(deployed, anHourOn("2026-08-24", 8), [
      { path: "/", views: "1" },
    ]);

    // When a run asks for the count including them.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--include-bots",
      "--summaries",
      deployed.bucket,
    ]);

    // Then the difference is named. Crawlers were most of the traffic in the
    // hour #56 was measured against, so the two numbers are far apart.
    expect(run.code).toBe(1);
    expect(run.error).toContain("--include-bots");
    expect(run.error).toContain("crawlers left out");
  });

  it("reports the visitors of one window and refuses to add two", async () => {
    // Given two hours, each carrying its own visitor count.
    const deployed = await aBucket();
    await putSummary(
      deployed,
      anHourOn("2026-08-24", 7),
      [{ path: "/", views: "9" }],
      { visitors: { distinct: 7, additive: false } },
    );
    await putSummary(
      deployed,
      anHourOn("2026-08-24", 8),
      [{ path: "/", views: "4" }],
      { visitors: { distinct: 3, additive: false } },
    );

    // When one hour is asked about, and then both.
    const one = await cli([
      "pageviews",
      "--last",
      "2h",
      "--summaries",
      deployed.bucket,
    ]);
    const both = await cli([
      "pageviews",
      "--last",
      "3h",
      "--summaries",
      deployed.bucket,
    ]);

    // Then one window reports its count and two report none. A visitor
    // carries a new identifier every day, so ten here would be everybody who
    // came back counted twice.
    expect(one.error).toContain("3 visitors in that window");
    expect(both.error).toContain("do not add");
    expect(both.error).not.toContain("10 visitors");
  });

  it("says how old an answer from last week is", async () => {
    // Given an hour computed six days ago, which is what a bucket looks like
    // after the schedules stopped firing.
    const deployed = await aBucket();
    await putSummary(
      deployed,
      anHourOn("2026-08-24", 8),
      [{ path: "/", views: "1" }],
      { computedAt: "2026-08-18T08:15:00.000Z" },
    );

    // When it is read.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--summaries",
      deployed.bucket,
    ]);

    // Then the age is in days. A reader comparing this against anything else
    // needs the order of magnitude before they need the minutes.
    expect(run.error).toContain("6 days ago");
  });

  it("names the parameter a stored search summary was computed with", async () => {
    // Given a searches summary computed for the default parameter.
    const deployed = await aBucket();
    const window = anHourOn("2026-08-24", 8);
    const searchQuestion = { ...question, name: "searches" };

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.bucket,
          Key: summaryKey(searchQuestion, window),
          Body: JSON.stringify({
            schemaVersion: summarySchemaVersion,
            question: searchQuestion,
            window: summarySpan(window),
            computedAt: now.toISOString(),
            columns: ["term", "searches", "redirected"],
            rows: [{ term: "happy", searches: "3", redirected: "1" }],
          }),
        },
      });

    // When a run names a different parameter.
    const run = await cli([
      "searches",
      "--last",
      "2h",
      "--param",
      "term",
      "--summaries",
      deployed.bucket,
    ]);

    // Then the difference is named. The parameter decides what the rows
    // mean, and a stored answer for `q` says nothing about `term`.
    expect(run.code).toBe(1);
    expect(run.error).toContain("--param: asked for term, computed with q");
  });

  it("leaves a question with no stated arithmetic to one window", async () => {
    // Given a site's own rollup, which says nothing about how its rows add
    // across windows, and two stored hours of it.
    const deployed = await aBucket();
    const countries: Rollup = {
      name: "countries",
      summary: "Count views by country.",
      description: "Counts where readers were.",
      isRanked: true,
      body: () => "SELECT 1",
    };
    const ownQuestion = { ...question, name: countries.name };

    for (const hour of [7, 8]) {
      const window = anHourOn("2026-08-24", hour);

      // oxlint-disable-next-line eslint/no-await-in-loop
      await deployed.simAws
        .region("us-east-1")
        .account()
        .s3()
        .putObject({
          input: {
            Bucket: deployed.bucket,
            Key: summaryKey(ownQuestion, window),
            Body: JSON.stringify({
              schemaVersion: summarySchemaVersion,
              question: ownQuestion,
              window: summarySpan(window),
              computedAt: now.toISOString(),
              columns: ["country", "views"],
              rows: [{ country: "GB", views: "2" }],
            }),
          },
        });
    }

    // When a span covering both is asked for.
    const asked = {
      request: rollupRequest({
        range: { from: new Date(now.getTime() - 10_800_000), to: now },
        dataset: defaultLogDataset,
      }),
      range: { from: new Date(now.getTime() - 10_800_000), to: now },
      summaries: deployed.bucket,
      runsTheQuery: false,
      database: defaultLogDataset.databaseName,
      workgroup: "rainlytics",
      region: undefined,
    };

    // Then it says so rather than adding columns it knows nothing about. A
    // guess would report a percentage as its own sum.
    await expect(
      summaryRows(countries, asked, {
        out: () => undefined,
        error: () => undefined,
        outIsTerminal: false,
      }),
    ).rejects.toThrow("totals field");
  });

  it("says what S3 refused, and which bucket it was asked about", async () => {
    // Given a bucket nobody created.
    const deployed = await aBucket();
    const missing = `rainlytics-summaries-${faker.string.uuid()}`;

    // When it is read.
    const run = await cli([
      "pageviews",
      "--last",
      "2h",
      "--summaries",
      missing,
    ]);

    // Then the message names the bucket. S3 says what it could not find and
    // never where it looked, and the pipeline has two buckets in it.
    expect(deployed.bucket).not.toBe(missing);
    expect(run.code).toBe(1);
    expect(run.error).toContain(missing);
  });
});
