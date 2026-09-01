// Validating report documents selected by notification manifests.

import {
  type ReportDocument,
  reportSchemaVersion,
} from "../report-document.js";
import { sameReportValue } from "../report-comparison-json.js";
import type { ReportPeriod } from "../report-periods.js";
import {
  isNotificationReportPeriod,
  parsedNotificationObject,
  unsupportedNotificationInput,
} from "./report-notification-input.js";

/** Parses one report document selected by a manifest entry. */
export function notificationReportDocumentFrom(
  body: string,
  key: string,
  expected: ReportPeriod,
): ReportDocument {
  const parsed = parsedNotificationObject(body, key, "report document");

  if (
    parsed["schemaVersion"] !== reportSchemaVersion ||
    !isNotificationReportPeriod(parsed["period"], expected.unit) ||
    !sameReportValue(parsed["period"], expected) ||
    typeof parsed["computedAt"] !== "string" ||
    Number.isNaN(Date.parse(parsed["computedAt"])) ||
    !Array.isArray(parsed["sections"])
  ) {
    throw unsupportedNotificationInput(
      key,
      "its report fields are malformed or mismatched",
    );
  }

  return parsed as unknown as ReportDocument;
}
