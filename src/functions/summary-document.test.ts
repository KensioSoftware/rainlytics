import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import type { AthenaOutcome } from "../athena/athena-outcome.js";
import { summarySchemaVersion } from "../rollup-summaries.js";
import { defaultRedirectStatuses } from "../rollups.js";
import { summaryDocument } from "./summary-document.js";

describe("what one answer becomes on S3", () => {
  const aQuestion = {
    name: "pageviews",
    includeBots: false,
    limit: 20,
    param: "q",
    redirectStatuses: defaultRedirectStatuses,
  };

  const anOutcome = (over: Partial<AthenaOutcome> = {}): AthenaOutcome => ({
    queryExecutionId: faker.string.uuid(),
    state: "SUCCEEDED",
    stateChangeReason: undefined,
    bytesScanned: faker.number.int(),
    milliseconds: faker.number.int(),
    region: "eu-west-2",
    columns: [
      { name: "path", type: "varchar" },
      { name: "views", type: "bigint" },
    ],
    rows: [],
    ...over,
  });

  it("carries the question, the span and the rows", () => {
    // Given an answer to one question over one hour.
    const outcome = anOutcome({ rows: [{ path: "/", views: "412" }] });

    // When the document is built.
    const document = summaryDocument(
      aQuestion,
      { granularity: "hourly", at: new Date("2026-08-23T08:41:00.000Z") },
      outcome,
      new Date("2026-08-23T09:15:04.212Z"),
    );

    // Then it says what it counted, when, and over what.
    expect(document).toStrictEqual({
      schemaVersion: summarySchemaVersion,
      question: aQuestion,
      window: {
        granularity: "hourly",
        from: "2026-08-23T08:00:00.000Z",
        until: "2026-08-23T09:00:00.000Z",
      },
      computedAt: "2026-08-23T09:15:04.212Z",
      columns: ["path", "views"],
      rows: [{ path: "/", views: "412" }],
    });
  });

  it("names its columns when it found no rows", () => {
    // Given a window that saw no traffic.
    const document = summaryDocument(
      aQuestion,
      { granularity: "daily", at: faker.date.past() },
      anOutcome(),
      faker.date.recent(),
    );

    // Then the document still says what it was looking for. Reading the
    // columns off the rows would leave an empty answer with no header, and an
    // empty CSV needs one as much as a full one does.
    expect(document.columns).toStrictEqual(["path", "views"]);
    expect(document.rows).toStrictEqual([]);
  });

  it("writes a cell Athena left out as null", () => {
    // Given a row with a value the query produced nothing for.
    const document = summaryDocument(
      aQuestion,
      { granularity: "hourly", at: faker.date.past() },
      anOutcome({ rows: [{ path: "/", views: undefined }] }),
      faker.date.recent(),
    );

    // Then it survives the round trip through JSON. `undefined` would drop
    // the key, and a reader would meet a row missing a column it can see in
    // `columns`.
    const onS3 = JSON.stringify(document.rows);

    expect(JSON.parse(onS3)).toStrictEqual([{ path: "/", views: null }]);
  });
});
