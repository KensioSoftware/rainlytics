import { describe, expect, it } from "vitest";

import {
  availableLogFields,
  deliveredLogFields,
  deliveredLogFieldNames,
  omittedLogFields,
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

  it("leaves out the fields that would make this personal data", () => {
    // Given a log set meant to be a record of requests.
    // Then neither the viewer's address nor their cookies are delivered.
    // Including either turns the raw store into a record of people, and the
    // raw store is the immutable half that everything else is rebuilt from.
    const delivered = new Set(deliveredLogFieldNames);
    expect(delivered).not.toContain("c-ip");
    expect(delivered).not.toContain("cs(Cookie)");
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
