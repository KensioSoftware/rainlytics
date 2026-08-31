import { assertStringIncludes, assertThrowsError } from "@kensio/smartass";
import { describe, it } from "vitest";

import { reportSchemaVersion } from "../report-document.js";
import { reportPeriod } from "../report-periods.js";
import { reportDocumentFrom } from "./report-document-reading.js";

describe("validating a stored calendar report document", () => {
  const period = reportPeriod(
    {
      unit: "week",
      at: new Date("2026-08-23T12:00:00.000Z"),
      timeZone: "UTC",
      weekStartsOn: "monday",
    },
    new Date("2026-08-24T00:00:00.000Z"),
  );
  const bucket = "rainlytics-summaries";
  const key = "reports/v1/UTC/week/monday/2026-08-17.json";
  const document = () => ({
    schemaVersion: reportSchemaVersion,
    period,
    sourceCoverage: {
      from: period.from,
      until: period.until,
      complete: true,
    },
    computedAt: "2026-08-24T00:30:00.000Z",
    sections: [],
  });
  const read = (value: unknown): unknown =>
    reportDocumentFrom(
      typeof value === "string" ? value : JSON.stringify(value),
      bucket,
      key,
      period,
    );

  it("refuses non-JSON and non-object values", () => {
    // Given text that is not JSON and a JSON array rather than a document.
    const text = assertThrowsError(() => read("{"));
    const array = assertThrowsError(() => read([]));

    // Then each problem is distinguished in the refusal.
    assertStringIncludes(text.message, "body is not JSON");
    assertStringIncludes(array.message, "JSON value is not an object");
  });

  it("refuses malformed fields and source coverage", () => {
    // Given a document without a period and one without coverage metadata.
    const fields = assertThrowsError(() =>
      read({ ...document(), period: null }),
    );
    const coverage = assertThrowsError(() =>
      read({ ...document(), sourceCoverage: "complete" }),
    );

    // Then neither can pass as a supported report document.
    assertStringIncludes(fields.message, "document fields are malformed");
    assertStringIncludes(coverage.message, "source coverage is malformed");
  });

  it("refuses a period that disagrees with its deterministic key", () => {
    // Given a weekly document whose declared first weekday differs from the
    // report period selected by its key.
    const mismatched = {
      ...document(),
      period: { ...period, weekStartsOn: "sunday" },
    };

    // When it is read.
    const error = assertThrowsError(() => read(mismatched));

    // Then the key-to-document mismatch is explicit.
    assertStringIncludes(error.message, "does not match the period");
  });

  it("treats null source coverage as an incomplete report", () => {
    // Given a document for which the producer could not cover the period.
    const incomplete = { ...document(), sourceCoverage: null };

    // When it is read.
    const error = assertThrowsError(() => read(incomplete));

    // Then it is described as incomplete instead of malformed.
    assertStringIncludes(error.message, "is incomplete");
  });
});
