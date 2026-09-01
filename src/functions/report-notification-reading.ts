// Validating notification manifests and report documents read from S3.

import type {
  ReportDayPeriod,
  ReportNotificationManifest,
  ReportNotificationManifestEntry,
} from "../report-notification-manifest.js";
import {
  reportNotificationManifestKey,
  reportNotificationManifestSchemaVersion,
} from "../report-notification-manifest.js";
import { reportKey } from "../report-key.js";
import { previousReportPeriod } from "../report-periods.js";
import {
  isNotificationReportPeriod,
  isNotificationRecord,
  parsedNotificationObject,
  unsupportedNotificationInput,
} from "./report-notification-input.js";

/** Parses and validates one notification completion document. */
export function reportNotificationManifestFrom(
  body: string,
  key: string,
): ReportNotificationManifest {
  const parsed = parsedNotificationObject(body, key, "notification manifest");

  if (
    parsed["kind"] !== "calendar-report-notification" ||
    parsed["schemaVersion"] !== reportNotificationManifestSchemaVersion ||
    typeof parsed["createdAt"] !== "string" ||
    Number.isNaN(Date.parse(parsed["createdAt"])) ||
    !isNotificationReportPeriod(parsed["closingDay"], "day") ||
    !Array.isArray(parsed["reports"]) ||
    parsed["reports"].length === 0
  ) {
    throw unsupportedNotificationInput(
      key,
      "its manifest fields are malformed",
    );
  }

  const reports = parsed["reports"].map((entry) => manifestEntry(entry, key));
  const manifest: ReportNotificationManifest = {
    kind: "calendar-report-notification",
    schemaVersion: reportNotificationManifestSchemaVersion,
    createdAt: parsed["createdAt"],
    closingDay: parsed["closingDay"] as ReportDayPeriod,
    reports,
  };

  if (reportNotificationManifestKey(manifest) !== key) {
    throw unsupportedNotificationInput(
      key,
      "its closing day does not match its S3 key",
    );
  }

  const units = new Set(reports.map(({ period }) => period.unit));
  if (units.size !== reports.length) {
    throw unsupportedNotificationInput(
      key,
      "it contains a repeated calendar period",
    );
  }

  return manifest;
}

/** One manifest entry with deterministic current and previous keys. */
function manifestEntry(
  value: unknown,
  manifestKey: string,
): ReportNotificationManifestEntry {
  if (
    !isNotificationRecord(value) ||
    !isNotificationReportPeriod(value["period"]) ||
    typeof value["key"] !== "string" ||
    typeof value["previousKey"] !== "string"
  ) {
    throw unsupportedNotificationInput(
      manifestKey,
      "one report entry is malformed",
    );
  }

  const period = value["period"];
  if (
    value["key"] !== reportKey(period) ||
    value["previousKey"] !== reportKey(previousReportPeriod(period))
  ) {
    throw unsupportedNotificationInput(
      manifestKey,
      "one report entry has a key that does not match its period",
    );
  }

  return {
    period,
    key: value["key"],
    previousKey: value["previousKey"],
  };
}
