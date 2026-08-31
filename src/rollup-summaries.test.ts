import {
  assertFalse,
  assertIdentical,
  assertInstanceOf,
  assertObjectEquals,
  assertStringMatches,
  assertThrowsError,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { rollups } from "./rollup-questions.js";
import { defaultRedirectStatuses } from "./rollups.js";
import {
  neverComputed,
  type RollupSummary,
  summaryKey,
  type SummaryQuestion,
  type SummaryLookup,
  summarySchemaVersion,
} from "./rollup-summaries.js";
import {
  type SummaryGranularity,
  summaryGranularities,
  summarySpan,
  type SummaryWindow,
} from "./summary-windows.js";

describe("where a rollup summary lives", () => {
  const aQuestion = (over: Partial<SummaryQuestion> = {}): SummaryQuestion => ({
    name: faker.helpers.arrayElement(rollups).name,
    includeBots: faker.datatype.boolean(),
    limit: faker.number.int({ min: 1, max: 100 }),
    param: faker.word.noun(),
    redirectStatuses: defaultRedirectStatuses,
    ...over,
  });

  /** How long each window is, written out here and not read from the code. */
  const lengthOf: Readonly<Record<SummaryGranularity, number>> = {
    hourly: 3_600_000,
    daily: 86_400_000,
  };

  /** The first instant of some window, addressed in UTC. */
  const aWindowStart = (granularity: SummaryGranularity): number =>
    Date.UTC(
      2026,
      faker.number.int({ min: 0, max: 11 }),
      faker.number.int({ min: 1, max: 28 }),
      granularity === "hourly" ? faker.number.int({ min: 0, max: 23 }) : 0,
    );

  it.each(summaryGranularities)(
    "addresses one window from any instant inside it (%s)",
    (granularity) => {
      // Given a question, and two moments in the same window.
      const question = aQuestion();
      const start = aWindowStart(granularity);
      const opened: SummaryWindow = { granularity, at: new Date(start) };
      const later: SummaryWindow = {
        granularity,
        at: new Date(
          start + faker.number.int({ min: 1, max: lengthOf[granularity] - 1 }),
        ),
      };

      // Then both address the one summary. A job runs on a lag and hands over
      // whatever time it is when it runs, and working out where the window
      // began is this module's job and not the caller's.
      assertIdentical(
        summaryKey(question, later),
        summaryKey(question, opened),
      );
    },
  );

  it.each(summaryGranularities)(
    "puts the end of one window and the start of the next in two objects (%s)",
    (granularity) => {
      // Given the last instant of a window and the first of the one after it.
      const question = aQuestion();
      const start = aWindowStart(granularity);
      const last = new Date(start + lengthOf[granularity] - 1);
      const next = new Date(start + lengthOf[granularity]);

      // Then they are two summaries. An instant is in one window and never
      // in two, and neither falls between them.
      assertFalse(
        Object.is(
          summaryKey(question, { granularity, at: next }),
          summaryKey(question, { granularity, at: last }),
        ),
      );
    },
  );

  it("reads an instant in UTC, whatever the clock on the machine says", () => {
    // Given the last half hour of a UTC day and the first half hour of one,
    // for a question that counts by day.
    const question = aQuestion({ name: "pageviews" });
    const nearlyMidnight = new Date("2026-08-27T23:30:00Z");
    const justAfter = new Date("2026-08-27T00:30:00Z");

    // Then both land in the day they are in. A machine an hour east of UTC
    // reads the first as the 28th and one an hour west reads the second as
    // the 26th, and a summary stored under either is a day nobody asked for.
    assertIdentical(
      summaryKey(question, { granularity: "daily", at: nearlyMidnight }),
      "summaries/v1/pageviews/daily/2026-08-27.json",
    );
    assertIdentical(
      summaryKey(question, { granularity: "daily", at: justAfter }),
      "summaries/v1/pageviews/daily/2026-08-27.json",
    );
  });

  it("writes the layout the job and the command both address", () => {
    // Given a question and an instant partway through an hour.
    const question = aQuestion({ name: "status-codes" });
    const at = new Date("2026-08-27T14:37:12.500Z");

    // Then the key is the one below. Two literals that happen to agree today
    // is how a job comes to write under a prefix nothing fetches, and a 404
    // is all either half would ever see of it.
    assertIdentical(
      summaryKey(question, { granularity: "hourly", at }),
      "summaries/v1/status-codes/hourly/2026-08-27T14Z.json",
    );
    assertIdentical(
      summaryKey(question, { granularity: "daily", at }),
      "summaries/v1/status-codes/daily/2026-08-27.json",
    );
  });

  it.each(summaryGranularities)(
    "names windows in an order S3 lists them in (%s)",
    (granularity) => {
      // Given a run of windows, each one after the last.
      const question = aQuestion();
      const opened = aWindowStart(granularity);
      const keys = Array.from({ length: 12 }, (_unused, index) =>
        summaryKey(question, {
          granularity,
          at: new Date(opened + index * lengthOf[granularity]),
        }),
      );

      // Then every key sorts after the key before it. S3 lists a prefix in
      // that order, and a reader after the most recent answer takes the last
      // line of the listing and fetches nothing else.
      const outOfOrder = keys.filter(
        (key, index) => index > 0 && key <= (keys[index - 1] ?? ""),
      );
      assertObjectEquals(outOfOrder, []);
    },
  );

  it("gives two questions two places to be", () => {
    // Given one window, and two of the questions the package ships.
    const [first = "pageviews", second = "referrers"] = faker.helpers
      .arrayElements(rollups, 2)
      .map((rollup) => rollup.name);
    const window: SummaryWindow = {
      granularity: "daily",
      at: faker.date.past(),
    };

    // Then each has a key of its own. One overwriting the other would leave
    // whichever ran last answering under both names.
    const secondKey = summaryKey(aQuestion({ name: second }), window);
    const firstKey = summaryKey(aQuestion({ name: first }), window);
    assertFalse(Object.is(secondKey, firstKey));
  });

  it("carries the schema version a reader has to agree with", () => {
    // Given any summary's key.
    const key = summaryKey(aQuestion(), {
      granularity: "daily",
      at: faker.date.past(),
    });

    // Then the version is a segment of it. A command released against a
    // later shape asks under its own prefix and gets a 404, where reading
    // this one would hand it fields that have moved.
    assertIdentical(key.split("/").at(1), `v${String(summarySchemaVersion)}`);
  });

  it("refuses a name no rollup can carry", () => {
    // Given a question named the way nothing in this package names one.
    const naming = (): string =>
      summaryKey(aQuestion({ name: "Page Views" }), {
        granularity: "daily",
        at: faker.date.past(),
      });

    // Then it is refused here. A space in a key is legal on S3 and awkward
    // everywhere a person meets it afterwards.
    {
      const error = assertThrowsError(naming);
      assertStringMatches(error.message, /Page Views/u);
    }
  });

  it("refuses a window addressed by an invalid Date", () => {
    // Given an instant that parsed into nothing.
    const addressing = (): string =>
      summaryKey(aQuestion(), {
        granularity: "hourly",
        at: new Date(faker.word.noun()),
      });

    // Then it says so, rather than writing a summary under a key holding
    // "NaN" that every later fetch misses.
    assertInstanceOf(assertThrowsError(addressing), RangeError);
  });
});

describe("what a rollup summary holds", () => {
  const aSummary = (): RollupSummary => ({
    schemaVersion: summarySchemaVersion,
    question: {
      name: "pageviews",
      includeBots: false,
      limit: 20,
      param: "q",
      redirectStatuses: defaultRedirectStatuses,
    },
    window: summarySpan({ granularity: "daily", at: faker.date.past() }),
    computedAt: faker.date.recent().toISOString(),
    columns: ["path", "views"],
    rows: [
      { path: `/${faker.word.noun()}/`, views: String(faker.number.int(500)) },
      { path: `/${faker.word.noun()}/`, views: null },
    ],
    visitors: { distinct: faker.number.int(500), additive: false },
  });

  it("comes back from S3 as the document the job wrote", () => {
    // Given a summary, written and read the way S3 carries one.
    const written = aSummary();

    // When it makes the round trip.
    const onS3 = JSON.stringify(written);
    const read = JSON.parse(onS3) as RollupSummary;

    // Then nothing about it changed. Every field is something JSON holds,
    // which is why the instants are text. A `Date` here would be a string on
    // the way back and a type saying otherwise the whole way.
    assertObjectEquals(read, written);
  });

  it("answers for a window nobody has computed", () => {
    // Given a lookup that found no object at all, and one that found a
    // summary with no rows in it.
    const found: SummaryLookup = neverComputed;
    const quiet: SummaryLookup = { ...aSummary(), rows: [] };

    // Then the two are different answers, and the first prints as the
    // sentence it is. A quiet Sunday and a job that died on Sunday night
    // would otherwise be the same 404.
    assertFalse(Object.is(found, quiet));
    assertIdentical(found, "never computed");
  });

  it("says in the document that a visitor count does not add", () => {
    // Given a month of daily summaries, as somebody reading with jq has.
    const month = faker.helpers.multiple(() => aSummary(), { count: 30 });

    // When they are read back.
    const onS3 = JSON.stringify(month);
    const read = JSON.parse(onS3) as readonly RollupSummary[];

    // Then each count says so where the count is. The identifier takes a new
    // salt every day, so a month of these added up counts everybody who came
    // back once for every day they came.
    for (const summary of read) {
      assertFalse(summary.visitors?.additive);
    }
  });
});
