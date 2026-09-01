// Writing one completion manifest after selected reports succeed.

import {
  reportNotificationManifest,
  reportNotificationManifestKey,
  type ReportDayPeriod,
} from "../report-notification-manifest.js";
import type { ReportPeriod, ReportPeriodUnit } from "../report-periods.js";
import type { ReportStore } from "./report-store.js";

/** Writes a manifest when this boundary closes a configured report period. */
export async function writeReportNotificationIfReady(
  periods: readonly ReportPeriod[],
  notificationPeriods: readonly ReportPeriodUnit[] | undefined,
  store: ReportStore,
): Promise<void> {
  if (notificationPeriods === undefined) {
    return;
  }

  const closingDay = periods.find(
    (period): period is ReportDayPeriod => period.unit === "day",
  );
  if (closingDay === undefined) {
    throw new Error("The calendar report run produced no closed day.");
  }

  const selected = periods.filter(
    (period) =>
      period.until === closingDay.until &&
      notificationPeriods.includes(period.unit),
  );
  if (selected.length === 0) {
    return;
  }

  const manifest = reportNotificationManifest({
    closingDay,
    periods: selected,
    createdAt: new Date(),
  });
  const key = reportNotificationManifestKey(manifest);
  const result = await store.writeNotification(key, manifest);

  // oxlint-disable-next-line eslint/no-console
  console.info(
    JSON.stringify({
      event:
        result === "written"
          ? "calendar-report-notification-ready"
          : "calendar-report-notification-already-ready",
      key,
      reports: selected.map(({ unit }) => unit),
    }),
  );
}
