// What a site writing its own report notification message imports.
//
// The entry a site names in `reportNotifications.message` runs as the
// publisher Lambda. It exports a handler built by `reportNotificationHandler`
// and hands it a message function, which can reuse any of the default
// message's pieces below. This entry point reaches the AWS SDK and belongs in
// a Lambda bundle, never in a page.

export {
  type ReportNotificationHandlerOptions,
  reportNotificationHandler,
} from "../functions/report-notification.js";
export {
  type ReportNotificationMessage,
  type ReportNotificationMessageFunction,
  type ReportNotificationMessageInput,
  type ReportNotificationReport,
  reportNotificationMessage,
  reportNotificationReportLines,
  reportNotificationSubject,
} from "../report-notification-message.js";
export { reportNotificationHeading } from "../report-notification-heading.js";
export {
  reportNotificationSectionHeading,
  reportNotificationSectionLines,
} from "../report-notification-section-lines.js";
export { reportNotificationMetricLines } from "../report-notification-metric-lines.js";
export { limitedReportNotificationMessage } from "../report-notification-size.js";
