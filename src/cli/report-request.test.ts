import {
  assertIdentical,
  assertInstanceOf,
  assertStringIncludes,
  assertThrowsError,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import type { CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
import { reportRequestFrom } from "./report-request.js";

describe("selecting a calendar report from the command line", () => {
  const context = (
    args: readonly string[],
    options: CommandContext["options"] = {},
  ): CommandContext => ({
    args,
    options: { summaries: faker.string.uuid(), ...options },
    io: {
      out: (text) => void text,
      error: (text) => void text,
      outIsTerminal: false,
    },
  });

  it("selects the week containing a date in the deployment's calendar", () => {
    // Given a Thursday in a London week, with the deployment's calendar
    // settings on the command line.
    const asked = context(["week", "2026-08-27"], {
      "time-zone": "Europe/London",
      "week-starts-on": "monday",
    });

    // When the report request is read.
    const request = reportRequestFrom(asked);

    // Then it addresses the Monday-first report without the caller deriving
    // the encoded S3 key.
    assertIdentical(request.period.unit, "week");
    assertIdentical(request.period.startsOn, "2026-08-24");
    assertIdentical(request.period.timeZone, "Europe/London");
    assertIdentical(request.period.weekStartsOn, "monday");
  });

  it("accepts the short month and year selectors", () => {
    // Given the natural selectors for two larger report periods.
    // When each request is read.
    const month = reportRequestFrom(context(["month", "2026-07"]));
    const year = reportRequestFrom(context(["year", "2025"]));

    // Then each expands to the first date of the intended calendar period.
    assertIdentical(month.period.startsOn, "2026-07-01");
    assertIdentical(year.period.startsOn, "2025-01-01");
  });

  it("refuses an invalid date before reading S3", () => {
    // Given a calendar date that never occurred.
    const reading = (): unknown =>
      reportRequestFrom(context(["day", "2026-02-30"]));

    // When the request is read.
    const error = assertThrowsError(reading);

    // Then it is a command-line error that names the bad selector.
    assertInstanceOf(error, UsageError);
    assertStringIncludes(error.message, "2026-02-30");
  });

  it("explains the selector spelling for each report unit", () => {
    // Given selectors that do not match the unit-specific forms.
    const year = assertThrowsError(() =>
      reportRequestFrom(context(["year", "twenty-six"])),
    );
    const month = assertThrowsError(() =>
      reportRequestFrom(context(["month", "2026/08"])),
    );
    const day = assertThrowsError(() =>
      reportRequestFrom(context(["day", "23 August 2026"])),
    );

    // Then each refusal describes the accepted form for that unit.
    assertStringIncludes(year.message, "YYYY or YYYY-MM-DD");
    assertStringIncludes(month.message, "YYYY-MM or YYYY-MM-DD");
    assertStringIncludes(day.message, "YYYY-MM-DD");
  });

  it("refuses a date skipped by the selected calendar", () => {
    // Given the day Samoa skipped when it moved across the date line.
    const reading = (): unknown =>
      reportRequestFrom(
        context(["day", "2011-12-30"], { "time-zone": "Pacific/Apia" }),
      );

    // When the request is read.
    const error = assertThrowsError(reading);

    // Then the refusal names the absent local date and calendar.
    assertStringIncludes(error.message, "2011-12-30");
    assertStringIncludes(error.message, "Pacific/Apia");
  });

  it("refuses an invalid time zone and a period that has not closed", () => {
    // Given a time zone Intl cannot resolve and a day far in the future.
    const zone = assertThrowsError(() =>
      reportRequestFrom(
        context(["day", "2026-08-23"], { "time-zone": "Not/A_Zone" }),
      ),
    );
    const future = assertThrowsError(() =>
      reportRequestFrom(context(["day", "2099-01-01"])),
    );

    // Then both are command-line errors, before any S3 request can start.
    assertInstanceOf(zone, UsageError);
    assertStringIncludes(zone.message, "not valid");
    assertInstanceOf(future, UsageError);
    assertStringIncludes(future.message, "has not closed");
  });

  it("requires exactly one known unit and one date", () => {
    // Given missing, extra and unknown positional arguments.
    const missing = assertThrowsError(() => reportRequestFrom(context([])));
    const extra = assertThrowsError(() =>
      reportRequestFrom(context(["day", "2026-08-23", "extra"])),
    );
    const unit = assertThrowsError(() =>
      reportRequestFrom(context(["quarter", "2026-08-23"])),
    );

    // Then the command shape and supported units are explicit.
    assertStringIncludes(missing.message, "takes a unit and a date");
    assertStringIncludes(extra.message, "takes a unit and a date");
    assertStringIncludes(unit.message, "day, week, month or year");
  });

  it("requires the summaries bucket used by the existing readers", () => {
    // Given an explicitly empty bucket option, which overrides any ambient
    // environment variable with no bucket at all.
    const reading = (): unknown =>
      reportRequestFrom(context(["day", "2026-08-23"], { summaries: "" }));

    // When the request is read.
    const error = assertThrowsError(reading);

    // Then the same option and environment variable as summary reads are
    // named in the refusal.
    assertInstanceOf(error, UsageError);
    assertStringIncludes(error.message, "--summaries");
    assertStringIncludes(error.message, "RAINLYTICS_SUMMARY_BUCKET");
  });

  it("refuses a tabular output before making a read", () => {
    // Given a report asked for as CSV.
    const reading = (): unknown =>
      reportRequestFrom(context(["day", "2026-08-23"], { output: "csv" }));

    // When the request is read.
    const error = assertThrowsError(reading);

    // Then the JSON-only public output is explained as a usage error.
    assertInstanceOf(error, UsageError);
    assertStringIncludes(error.message, "versioned document as JSON");
  });
});
