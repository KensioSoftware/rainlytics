import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import {
  assertQueryableName,
  defaultLogDataset,
  qualifiedTableName,
} from "./dataset.js";

describe("what the log dataset is called", () => {
  it("names a database and a table the CDK and the CLI both read", () => {
    // Given the default names.
    // Then they are the ones a construct creates and a query names. Two
    // literals that happen to match today is how a query comes to name a
    // table nobody made, and nothing between here and Athena would catch it.
    expect(defaultLogDataset.databaseName).toBe("rainlytics");
    expect(defaultLogDataset.tableName).toBe("cloudfront_logs");
  });

  it("quotes the pair the way a query writes them", () => {
    // Given a dataset with names of its own.
    const dataset = {
      databaseName: "site_analytics",
      tableName: "edge_logs",
    };

    // Then the qualified name is what goes after FROM.
    expect(qualifiedTableName(dataset)).toBe('"site_analytics"."edge_logs"');
    expect(qualifiedTableName()).toBe('"rainlytics"."cloudfront_logs"');
  });

  it("refuses to quote a name Athena would not find", () => {
    // Given a dataset carrying a name no Rainlytics table can have been
    // created under.
    const naming = (): string =>
      qualifiedTableName({
        databaseName: "Rainlytics Logs",
        tableName: "cloudfront_logs",
      });

    // Then it refuses here rather than quoting it into SQL. The construct
    // checks the same names at synthesis, and a caller writing a query has
    // its own names and need never have gone through the construct.
    expect(naming).toThrow(/Rainlytics Logs/u);
  });

  it("accepts the names Athena reads back plainly", () => {
    // Given lowercase names of letters, digits and underscores.
    const naming = (): void => {
      assertQueryableName("table", "cloudfront_logs_2026");
    };

    // Then nothing objects.
    expect(naming).not.toThrow();
  });

  it.each([
    ["a capital", "Rainlytics"],
    ["a space", "rainlytics logs"],
    ["a hyphen", "rainlytics-logs"],
    ["a leading digit", "2026_logs"],
    ["nothing at all", ""],
  ])("refuses a name carrying %s", (_what, name) => {
    // Given a name Glue would accept and Athena would make awkward.
    const naming = (): void => {
      assertQueryableName("database", name);
    };

    // Then it is refused where somebody can still change it. Athena
    // lowercases what it stores, so the alternative is a deployed dataset
    // answering to a name the caller has to work out.
    expect(naming).toThrow(/database/u);
  });

  it("names what it refused, so the message can be acted on", () => {
    // Given a name that will not do.
    const name = `${faker.word.noun()} ${faker.word.noun()}`;

    // Then the refusal quotes it back.
    expect(() => {
      assertQueryableName("table", name);
    }).toThrow(name);
  });
});
