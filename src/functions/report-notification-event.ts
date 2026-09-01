// Selecting notification manifest keys from an S3 event.

import { reportNotificationManifestPrefix } from "../report-notification-manifest.js";

/** Reads and deduplicates Object-created keys for the configured bucket. */
export function reportNotificationKeysFrom(
  event: unknown,
  bucket: string,
): readonly string[] {
  if (!isRecord(event) || !Array.isArray(event["Records"])) {
    throw new Error("The report notification function needs an S3 event.");
  }

  const keys = new Set<string>();
  for (const record of event["Records"]) {
    const selected = selectedKey(record, bucket);
    keys.add(selected);
  }

  if (keys.size === 0) {
    throw new Error("The report notification S3 event contains no records.");
  }

  return [...keys];
}

/** One Object-created record for this deployment's summaries bucket. */
function selectedKey(record: unknown, bucket: string): string {
  if (!isRecord(record)) {
    throw new Error("A report notification S3 record is malformed.");
  }

  const eventName = record["eventName"];
  const s3 = record["s3"];
  if (!isRecord(s3)) {
    throw new Error("A report notification S3 record has no S3 fields.");
  }

  const bucketField = s3["bucket"];
  const objectField = s3["object"];
  if (
    typeof eventName !== "string" ||
    !eventName.startsWith("ObjectCreated:") ||
    !isRecord(bucketField) ||
    bucketField["name"] !== bucket ||
    !isRecord(objectField) ||
    typeof objectField["key"] !== "string"
  ) {
    throw new Error(
      "The report notification function received an unexpected S3 record.",
    );
  }

  const key = decodeURIComponent(objectField["key"].replaceAll("+", " "));
  if (
    !key.startsWith(reportNotificationManifestPrefix) ||
    !key.endsWith(".json")
  ) {
    throw new Error(
      `The S3 object ${key} is not a report notification manifest.`,
    );
  }

  return key;
}

/** Whether a value is a named object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
