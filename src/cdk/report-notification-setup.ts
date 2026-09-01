// Matching report notification settings to one summaries deployment.

import {
  type ReportNotificationConfiguration,
  type ReportNotificationsProps,
  reportNotificationConfiguration,
} from "./report-notification-configuration.js";

/** Refuses configured question names this report deployment never writes. */
export function assertReportNotificationQuestions(
  configuration: ReportNotificationConfiguration,
  available: readonly string[],
): void {
  if (configuration.questions === undefined) {
    return;
  }

  for (const question of configuration.questions) {
    if (!available.includes(question)) {
      throw new Error(
        `The report notification question ${JSON.stringify(question)} is not` +
          " computed by this RollupSummaries deployment.",
      );
    }
  }
}

/** Settles optional notification settings against the reports being written. */
export function configuredReportNotifications(
  props: ReportNotificationsProps | undefined,
  availableQuestions: readonly string[],
): ReportNotificationConfiguration | undefined {
  if (props === undefined) {
    return undefined;
  }

  const configuration = reportNotificationConfiguration(props);
  assertReportNotificationQuestions(configuration, availableQuestions);
  return configuration;
}
