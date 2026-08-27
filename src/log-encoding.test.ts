import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { decodedColumn, decodedParameter } from "./log-encoding.js";

describe("reading CloudFront's encoding back off a record", () => {
  it("takes two passes off a whole column", () => {
    // Given a column carrying the encoding CloudFront wrote.
    // Then it is decoded twice. One pass answers the URI the browser sent,
    // which reads no better than the record.
    expect(decodedColumn("cs_uri_stem")).toBe(
      "url_decode(url_decode(cs_uri_stem))",
    );
  });

  it("takes one pass off a query-string parameter", () => {
    // Given a parameter read out of a record.
    // Then it is decoded once. `url_extract_parameter` decodes its own
    // answer, and a second pass here would decode a term holding a percent
    // sequence twice.
    expect(decodedParameter("q")).toBe(
      "url_decode(url_extract_parameter(cs_uri_stem || '?' || cs_uri_query," +
        " 'q'))",
    );
  });

  it("joins the path and the query a record holds separately", () => {
    // Given a record, which carries no whole URL.
    // Then the two columns are joined with the `?` that was between them
    // before CloudFront split them up. A caller names neither, since a record
    // holds one query string in one column.
    expect(decodedParameter(faker.word.noun())).toContain(
      "cs_uri_stem || '?' || cs_uri_query",
    );
  });

  it("quotes the parameter it was asked for", () => {
    // Given a parameter named the way a caller would name it, as the text
    // between the `?` and the `=` rather than as SQL.
    const parameter = faker.word.noun();

    // Then the function writes the literal, so a caller has no quoting rule
    // of its own to get right.
    expect(decodedParameter(parameter)).toContain(`, '${parameter}')`);
  });

  it("takes a parameter holding a quote without breaking the statement", () => {
    // Given a parameter carrying the one character SQL string syntax cares
    // about.
    // Then it is doubled, so the statement still parses and still names the
    // parameter that was asked for.
    expect(decodedParameter("it's")).toContain("'it''s'");
  });
});
