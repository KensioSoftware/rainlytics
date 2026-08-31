// Validating a calendar report document read from S3.

import {
  type ReportDocument,
  reportSchemaVersion,
} from "../report-document.js";
import type { ReportPeriod } from "../report-periods.js";

/** Parses one document and checks the public version and selected period. */
export function reportDocumentFrom(
  body: string,
  bucket: string,
  key: string,
  asked: ReportPeriod,
): ReportDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw unsupported(bucket, key, "its body is not JSON");
  }

  if (!isRecord(parsed)) {
    throw unsupported(bucket, key, "its JSON value is not an object");
  }

  if (parsed["schemaVersion"] !== reportSchemaVersion) {
    throw unsupported(
      bucket,
      key,
      `it uses schema version ${JSON.stringify(parsed["schemaVersion"])} and` +
        ` this Rainlytics version reads ${String(reportSchemaVersion)}`,
    );
  }

  const period = parsed["period"];
  const computedAt = parsed["computedAt"];
  const sections = parsed["sections"];

  if (
    !isRecord(period) ||
    typeof computedAt !== "string" ||
    Number.isNaN(Date.parse(computedAt)) ||
    !Array.isArray(sections)
  ) {
    throw unsupported(bucket, key, "its document fields are malformed");
  }

  if (!samePeriod(period, asked)) {
    throw unsupported(
      bucket,
      key,
      "the period inside it does not match the period in its S3 key",
    );
  }

  const coverage = parsed["sourceCoverage"];

  if (
    coverage === null ||
    (isRecord(coverage) && coverage["complete"] === false)
  ) {
    throw new Error(
      `The ${asked.unit} report starting ${asked.startsOn} in ${bucket} is` +
        ` incomplete. Its source coverage does not contain the whole period.` +
        ` The report job can overwrite it after the missing source is` +
        ` recomputed. Reading it did not run Athena.`,
    );
  }

  if (!isRecord(coverage) || coverage["complete"] !== true) {
    throw unsupported(bucket, key, "its source coverage is malformed");
  }

  return parsed as unknown as ReportDocument;
}

/** Whether a parsed JSON value is an object with named fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether the document under a key describes the period that key selects. */
function samePeriod(
  stored: Readonly<Record<string, unknown>>,
  asked: ReportPeriod,
): boolean {
  return (
    stored["unit"] === asked.unit &&
    stored["timeZone"] === asked.timeZone &&
    stored["startsOn"] === asked.startsOn &&
    stored["endsBefore"] === asked.endsBefore &&
    stored["from"] === asked.from &&
    stored["until"] === asked.until &&
    (asked.unit !== "week" || stored["weekStartsOn"] === asked.weekStartsOn)
  );
}

/** A report object this CLI version cannot safely expose. */
function unsupported(bucket: string, key: string, reason: string): Error {
  return new Error(
    `The object ${key} in ${bucket} is not a supported report document` +
      ` because ${reason}.`,
  );
}
