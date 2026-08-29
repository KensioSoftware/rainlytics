import { describe, expect, it } from "vitest";

import {
  availableLogFields,
  countsVisitorsFrom,
  deliveredLogColumnNames,
  deliveredLogFields,
  deliveredLogFieldNames,
  deliveredLogFieldsNamed,
  logColumnName,
  logFieldNamesWithoutAddress,
  omittedLogFields,
  visitorAddressField,
} from "./log-fields.js";

describe("the delivered log field set", () => {
  it("asks only for fields CloudFront actually offers", () => {
    // Given the fields Rainlytics asks CloudFront to deliver.
    // Then every one of them is a field standard logging v2 accepts. A typo
    // here would otherwise reach a deployment, or deliver a dataset with a
    // column permanently missing and nothing saying so.
    for (const field of deliveredLogFieldNames) {
      expect(availableLogFields).toContain(field);
    }
  });

  it("drops only the address from the set that leaves visitors uncounted", () => {
    // Given the field set a site delivers to hold no personal data.
    // Then it is the delivered set with the viewer's address taken out, and
    // every other question reads the same columns it always did.
    expect(logFieldNamesWithoutAddress).not.toContain(visitorAddressField);
    expect(logFieldNamesWithoutAddress).toStrictEqual(
      deliveredLogFieldNames.filter((name) => name !== visitorAddressField),
    );
  });

  it("counts visitors from the default set and from nothing narrower", () => {
    // Given the two field sets a site chooses between.
    // Then the default identifies a viewer and the other one cannot. This is
    // what `RollupSummaries` reads to decide whether to schedule a count.
    expect(countsVisitorsFrom(deliveredLogFieldNames)).toBe(true);
    expect(countsVisitorsFrom(logFieldNamesWithoutAddress)).toBe(false);
  });

  it("records omissions that CloudFront actually offers", () => {
    // Given the fields deliberately left out.
    // Then each is a real field, so the list documents a decision rather than
    // accumulating names nobody could have selected anyway.
    for (const field of omittedLogFields) {
      expect(availableLogFields).toContain(field);
    }
  });

  it("never both delivers and omits a field", () => {
    // Given both lists.
    // Then they do not overlap. The two are read as one decision, and a field
    // in both would make the omission note a lie.
    const delivered = new Set(deliveredLogFieldNames);
    for (const field of omittedLogFields) {
      expect(delivered).not.toContain(field);
    }
  });

  it("carries what the named rollups need", () => {
    // Given the rollups AGENTS.md names: pageviews by path, referrers,
    // device and browser breakdown, status codes and cache hit ratio.
    // Then the field each one groups by is delivered. This is the list that
    // breaks a rollup by omission rather than by error, so it is worth
    // stating as a test and not only as a comment.
    const delivered = new Set(deliveredLogFieldNames);
    expect(delivered).toContain("cs-uri-stem"); // Pageviews by path.
    expect(delivered).toContain("cs(Referer)"); // Referrers.
    expect(delivered).toContain("cs(User-Agent)"); // Device and browser.
    expect(delivered).toContain("sc-status"); // Status codes.
    expect(delivered).toContain("x-edge-result-type"); // Cache hit ratio.
  });

  it("carries the query string the beacon reports through", () => {
    // Given that layer 2 sends its data as a query string on a request the
    // access log records, rather than to an endpoint of its own.
    // Then dropping this field would silently remove the entire beacon, which
    // is why it is asserted apart from the rollup fields above.
    expect(new Set(deliveredLogFieldNames)).toContain("cs-uri-query");
  });

  it("carries the address a visitor count is computed from", () => {
    // Given the decision in KensioSoftware/rainlytics#53 to count unique
    // visitors with a hash of the viewer's address under a daily salt.
    // Then the address is delivered. Nothing downstream can hash a field the
    // delivery never asked for, and the records already written keep
    // whatever was delivered into them.
    expect(new Set(deliveredLogFieldNames)).toContain("c-ip");
  });

  it("keeps the address last in the delivered order", () => {
    // Given a dataset that already holds records written without it.
    // Then it is appended rather than placed where CloudFront lists it. A
    // delivery change rewrites nothing already in the bucket, and appending
    // a column leaves every earlier record readable in the order the table
    // declares.
    expect(deliveredLogFieldNames.at(-1)).toBe("c-ip");
  });

  it("still leaves out the cookies", () => {
    // Given that the visitor identifier is derived from the address.
    // Then the cookie header is not delivered as well. It would be a second
    // way to recognise the same person, and no rollup asks for one.
    expect(new Set(deliveredLogFieldNames)).not.toContain("cs(Cookie)");
  });

  it("asks for far fewer fields than a delivery will carry", () => {
    // Given that neither the CloudFront quotas page nor the CloudWatch Logs
    // one publishes a limit on `recordFields`, and that AWS documents a
    // `CreateDelivery` returning every standard field at once.
    // Then the ceiling on this set is the list of fields that exist, and
    // Rainlytics is nowhere near it. What keeps the set small is the storage
    // each field costs and the bytes every query then scans over it.
    expect(deliveredLogFieldNames.length).toBeLessThan(
      availableLogFields.length,
    );
  });
});

describe("what justifies a delivered field", () => {
  it("names a reader for every field it delivers", () => {
    // Given the delivered fields.
    // Then each one says what reads it, in a sentence rather than a word.
    //
    // This is the test that stops the set growing quietly. Every other case
    // here checks that something needed is present, so all of them pass when
    // a field nobody wants is added. Adding one now means writing down who
    // wants it, and a field nobody can name a reader for is one this catches
    // while it is still free to leave out.
    for (const field of deliveredLogFields) {
      const words = field.readBy.trim().split(/\s+/u);
      expect(
        words.length,
        `${field.name} needs a reader named, not "${field.readBy}"`,
      ).toBeGreaterThanOrEqual(4);
      expect(field.readBy.trim()).toMatch(/\.$/u);
    }
  });

  it("delivers each field once", () => {
    // Given the delivered fields.
    // Then no name appears twice. A duplicate would be delivered once and
    // paid for twice in this list's own accounting of what it costs.
    expect(new Set(deliveredLogFieldNames).size).toBe(
      deliveredLogFieldNames.length,
    );
  });
});

describe("the names a delivered field is read back under", () => {
  /**
   * What AWS does to a field name on the way into a Parquet file.
   *
   * Inferred from the eleven names KensioSoftware/rainlytics#9 read out of
   * delivered objects. Every run of characters outside `[A-Za-z0-9]` becomes
   * one underscore, a trailing underscore is dropped, and case survives.
   *
   * Written here and not in `log-fields.ts` on purpose. AWS documents the
   * transformation nowhere, so the declared name stays the one a table is
   * built from and this is what notices when a twelfth field disagrees with
   * the rule. The alternative is a column of nulls under a query that reports
   * success.
   */
  const asParquetWrites = (name: string): string =>
    name.replaceAll(/[^A-Za-z0-9]+/gu, "_").replace(/_$/u, "");

  it("spells each Parquet name the way AWS was observed to spell it", () => {
    // Given the declared fields.
    // Then the rule reproduces every one of them.
    for (const field of deliveredLogFields) {
      expect(field.parquetName, `Parquet name for ${field.name}`).toBe(
        asParquetWrites(field.name),
      );
    }
  });

  it("keeps the delivered spelling apart from the Parquet one", () => {
    // Given the two names each field carries.
    // Then the pair differs on every field Rainlytics delivers, which is why
    // a table cannot be built from the delivered names alone.
    for (const field of deliveredLogFields) {
      expect(field.parquetName).not.toBe(field.name);
    }
  });

  it("gives every field a column name Athena reads without escaping", () => {
    // Given the Glue column names.
    // Then each is lowercase letters, digits and underscores. Athena stores
    // every name lowercased, and anything else has to be quoted in every
    // query that ever reads it.
    for (const column of deliveredLogColumnNames) {
      expect(column).toMatch(/^[a-z][a-z0-9_]*$/u);
    }

    // And no two fields collide. Two columns of one name is a table Athena
    // refuses to query.
    expect(new Set(deliveredLogColumnNames).size).toBe(
      deliveredLogColumnNames.length,
    );
  });

  it("names the columns in the order the fields are delivered", () => {
    // Given the delivered fields.
    // Then the column list is those fields in that order, which is the order
    // a table declares and a `SELECT *` answers in.
    expect(deliveredLogColumnNames).toStrictEqual(
      deliveredLogFields.map((field) => logColumnName(field)),
    );
  });
});

describe("looking a delivered field up by name", () => {
  it("answers in the order it was asked", () => {
    // Given a narrower field set than the default, in its own order.
    const found = deliveredLogFieldsNamed(["cs-uri-stem", "timestamp(ms)"]);

    // Then that is what comes back. A table's columns are built from this,
    // and they have to match the order the objects carry.
    expect(found.map((field) => field.name)).toStrictEqual([
      "cs-uri-stem",
      "timestamp(ms)",
    ]);
  });

  it("refuses a field Rainlytics has never declared", () => {
    // Given a real CloudFront field that is not in the Rainlytics set.
    const looking = (): unknown => deliveredLogFieldsNamed(["x-edge-location"]);

    // Then it refuses, rather than guessing what Parquet would call it.
    expect(looking).toThrow(/x-edge-location/u);
    expect(looking).toThrow(/log-fields\.ts/u);
  });
});
