// Shared validation for report notification documents read from S3.

import { type ReportPeriod, reportPeriodUnits } from "../report-periods.js";

/** Parses a JSON object with an S3 key in any diagnostic. */
export function parsedNotificationObject(
  body: string,
  key: string,
  subject: string,
): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw unsupportedNotificationInput(key, `its ${subject} body is not JSON`);
  }

  if (!isNotificationRecord(parsed)) {
    throw unsupportedNotificationInput(
      key,
      `its ${subject} is not a JSON object`,
    );
  }

  return parsed;
}

/** Whether a value carries the fields of one report period. */
export function isNotificationReportPeriod(
  value: unknown,
  expectedUnit?: ReportPeriod["unit"],
): value is ReportPeriod {
  if (!isNotificationRecord(value)) {
    return false;
  }

  const unit = value["unit"];
  return (
    typeof unit === "string" &&
    reportPeriodUnits.includes(unit as ReportPeriod["unit"]) &&
    (expectedUnit === undefined || unit === expectedUnit) &&
    typeof value["timeZone"] === "string" &&
    typeof value["startsOn"] === "string" &&
    typeof value["endsBefore"] === "string" &&
    typeof value["from"] === "string" &&
    typeof value["until"] === "string" &&
    (unit !== "week" || typeof value["weekStartsOn"] === "string")
  );
}

/** An object that cannot be trusted as the document its key promises. */
export function unsupportedNotificationInput(
  key: string,
  reason: string,
): Error {
  return new Error(
    `The object ${key} is not a supported report notification input because` +
      ` ${reason}.`,
  );
}

/** Whether a parsed JSON value is a named object. */
export function isNotificationRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
