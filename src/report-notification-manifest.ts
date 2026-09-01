// The completion document that starts one calendar report notification.

import { reportKey } from "./report-key.js";
import {
  previousReportPeriod,
  type ReportPeriod,
  type ReportPeriodWithoutWeek,
} from "./report-periods.js";

/** The current report notification manifest and key shape. */
export const reportNotificationManifestSchemaVersion = 1;

/** The S3 prefix whose Object-created events start notification delivery. */
export const reportNotificationManifestPrefix = `report-notifications/v${String(reportNotificationManifestSchemaVersion)}/`;

/** One completed report and the adjacent report used for its comparison. */
export interface ReportNotificationManifestEntry {
  readonly period: ReportPeriod;
  readonly key: string;
  readonly previousKey: string;
}

/** One local day's completed reports, ready for notification. */
export interface ReportNotificationManifest {
  readonly kind: "calendar-report-notification";
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly closingDay: ReportDayPeriod;
  readonly reports: readonly ReportNotificationManifestEntry[];
}

/** Input for one report notification manifest. */
export interface ReportNotificationManifestInput {
  readonly closingDay: ReportDayPeriod;
  readonly periods: readonly ReportPeriod[];
  readonly createdAt: Date;
}

/** The closed day that gives one notification its local date. */
export type ReportDayPeriod = Omit<ReportPeriodWithoutWeek, "unit"> & {
  readonly unit: "day";
};

/** Builds the completion document written after one report run succeeds. */
export function reportNotificationManifest(
  input: ReportNotificationManifestInput,
): ReportNotificationManifest {
  if (Number.isNaN(input.createdAt.getTime())) {
    throw new RangeError(
      "Cannot build a report notification time from an invalid Date.",
    );
  }

  const day = input.closingDay;

  if (input.periods.length === 0) {
    throw new RangeError("A report notification needs at least one report.");
  }

  if (input.createdAt.getTime() < Date.parse(day.until)) {
    throw new RangeError(
      `A notification for ${day.startsOn} cannot be created before its` +
        ` reports close at ${day.until}.`,
    );
  }

  const units = new Set<string>();
  for (const period of input.periods) {
    if (period.until !== day.until) {
      throw new RangeError(
        `A notification for ${day.startsOn} cannot include the` +
          ` ${period.unit} report starting ${period.startsOn}, which closes` +
          ` at another boundary.`,
      );
    }

    if (units.has(period.unit)) {
      throw new RangeError(
        `A report notification cannot contain two ${period.unit} reports.`,
      );
    }
    units.add(period.unit);
  }

  return {
    kind: "calendar-report-notification",
    schemaVersion: reportNotificationManifestSchemaVersion,
    createdAt: input.createdAt.toISOString(),
    closingDay: day,
    reports: input.periods.map((period) => ({
      period,
      key: reportKey(period),
      previousKey: reportKey(previousReportPeriod(period)),
    })),
  };
}

/** The deterministic S3 key for one local day's notification manifest. */
export function reportNotificationManifestKey(
  manifest: ReportNotificationManifest,
): string {
  const day = manifest.closingDay;

  return [
    reportNotificationManifestPrefix.slice(0, -1),
    encodeURIComponent(day.timeZone),
    `${day.startsOn}.json`,
  ].join("/");
}
