import {
  assertStringIncludes,
  assertStringNotIncludes,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import type { ReportDocument } from "../report-document.js";
import { reportReadReport } from "./report-report.js";

describe("reporting a calendar report read", () => {
  it("names the bucket, object key, object age and one S3 GET", () => {
    // Given one object read six hours after S3 last modified it.
    const report = reportReadReport(
      {
        bucket: "rainlytics-summaries-example",
        key: "reports/v1/UTC/day/2026-08-23.json",
        lastModified: new Date("2026-08-24T00:30:00.000Z"),
        document: {
          period: { unit: "day", startsOn: "2026-08-23" },
        } as ReportDocument,
      },
      new Date("2026-08-24T06:30:00.000Z"),
    );

    // When the diagnostic is read.
    // Then it carries everything that stays outside piped JSON.
    assertStringIncludes(report, "rainlytics-summaries-example");
    assertStringIncludes(report, "reports/v1/UTC/day/2026-08-23.json");
    assertStringIncludes(report, "6 hours ago");
    assertStringIncludes(report, "1 GET");
    assertStringIncludes(report, "$4.0e-7");
    assertStringNotIncludes(report, "Athena");
  });
});
