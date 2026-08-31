import {
  assertIdentical,
  assertObjectEquals,
  assertUndefined,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { defaultLogDataset } from "../dataset.js";
import { savedQueryFrom } from "./saved-queries.js";

describe("one saved query, as Athena describes it", () => {
  it("carries what Athena reported", () => {
    // Given a named query the way `BatchGetNamedQuery` hands one back.
    const sql = `SELECT count(*) FROM ${faker.string.alpha(8)}`;
    const saved = savedQueryFrom({
      NamedQueryId: faker.string.uuid(),
      Name: "rainlytics-countries",
      Description: "Count views by country.",
      Database: "rainlytics",
      QueryString: sql,
      WorkGroup: "rainlytics",
    });

    // Then the four things running it needs come through untouched.
    assertObjectEquals(saved, {
      name: "rainlytics-countries",
      description: "Count views by country.",
      database: "rainlytics",
      sql,
    });
  });

  it("stands in for whatever the SDK left optional", () => {
    // Given a named query described with none of it. Every field is optional
    // in those types and present in practice, and this is the gap between
    // the two.
    const saved = savedQueryFrom({
      Name: undefined,
      Database: undefined,
      QueryString: undefined,
    });

    // Then the database falls back to the one a Rainlytics deployment
    // creates, and the rest is empty rather than undefined. Athena refuses
    // to save a query missing any of this, so nothing here is inventing an
    // answer for a query that could exist.
    assertIdentical(saved.database, defaultLogDataset.databaseName);
    assertIdentical(saved.name, "");
    assertIdentical(saved.sql, "");
    assertUndefined(saved.description);
  });
});
