import { assertIdentical } from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { toCsv } from "./csv.js";

describe("CSV output", () => {
  const twoColumns = (): readonly [string, string] => {
    const [first, second] = faker.helpers.uniqueArray(
      () => faker.word.noun(),
      2,
    );
    return [first ?? "first", second ?? "second"];
  };

  it("writes the header for a result that found nothing", () => {
    // Given a query that matched no rows, as an hour with no traffic gives.
    const [first, second] = twoColumns();

    // When the empty result is written.
    const csv = toCsv({ columns: [first, second], rows: [] });

    // Then the header is still there. A CSV whose first line is missing is
    // one that whatever opens it reads a column short.
    assertIdentical(csv, `${first},${second}\n`);
  });

  it("quotes a value carrying the delimiter", () => {
    // Given a referrer with a comma in it, which a query string easily has.
    const referrer = `https://example.com/?a=${faker.word.noun()},${faker.word.noun()}`;

    // When the row is written.
    const csv = toCsv({ columns: ["referrer"], rows: [{ referrer }] });

    // Then the value is quoted and the line still holds one field.
    assertIdentical(csv, `referrer\n"${referrer}"\n`);
  });

  it("doubles a quotation mark inside a value", () => {
    // Given a user agent carrying a quotation mark, which a crafted one can.
    const inside = faker.word.noun();

    // When the row is written.
    const csv = toCsv({
      columns: ["agent"],
      rows: [{ agent: `Mozilla/5.0 "${inside}"` }],
    });

    // Then each mark is doubled, which is how RFC 4180 escapes one.
    assertIdentical(csv, `agent\n"Mozilla/5.0 ""${inside}"""\n`);
  });

  it("keeps a value that spans lines inside one field", () => {
    // Given a path carrying a newline, which nothing in the record forbids.
    const path = `/${faker.word.noun()}\n/${faker.word.noun()}`;

    // When the row is written.
    const csv = toCsv({ columns: ["path"], rows: [{ path }] });

    // Then it is quoted, so the newline stays inside the field rather than
    // becoming a second record with the wrong number of columns.
    assertIdentical(csv, `path\n"${path}"\n`);
  });

  it("leaves a field empty where the row has no value", () => {
    // Given a row missing one column and carrying nothing in another.
    const views = faker.number.int({ min: 1, max: 9999 });

    // When it is written against all three columns.
    const csv = toCsv({
      columns: ["path", "referrer", "views"],
      rows: [{ path: undefined, views }],
    });

    // Then both gaps are empty fields and the row keeps its shape.
    assertIdentical(csv, `path,referrer,views\n,,${views}\n`);
  });

  it("writes the columns in the order the command asked for", () => {
    // Given a row whose keys are in a different order from the columns, which
    // is the order any object literal happens to be written in.
    const views = faker.number.int({ min: 1, max: 9999 });
    const path = `/${faker.word.noun()}`;

    // When it is written with the columns the other way round.
    const csv = toCsv({
      columns: ["path", "views"],
      rows: [{ views, path }],
    });

    // Then the columns decide, and the header describes what follows it.
    assertIdentical(csv, `path,views\n${path},${views}\n`);
  });
});
