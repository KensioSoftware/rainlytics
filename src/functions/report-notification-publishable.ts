// Checking a notification against what SNS accepts before publishing it.

import type { ReportNotificationMessage } from "../report-notification-message.js";

/** SNS refuses a message over 256 KB. */
const maximumMessageBytes = 262_144;

/**
 * The notification unchanged, or an error naming the rule it breaks.
 *
 * The default message always passes. A site's own message function is the
 * reason for checking, since SNS would otherwise refuse it with a bare
 * InvalidParameter that says nothing about which manifest or which rule.
 * https://docs.aws.amazon.com/sns/latest/api/API_Publish.html
 */
export function publishableReportNotification(
  notification: ReportNotificationMessage,
  manifestKey: string,
): ReportNotificationMessage {
  const { subject, message } =
    notification as Partial<ReportNotificationMessage>;
  const refuse = (reason: string): Error =>
    new Error(
      `The report notification for ${manifestKey} cannot be published` +
        ` because ${reason}.`,
    );

  if (
    typeof subject !== "string" ||
    subject.length === 0 ||
    subject.length >= 100 ||
    /\p{Cc}/u.test(subject)
  ) {
    throw refuse(
      "its subject is not 1 to 99 characters on one line with no control" +
        " characters",
    );
  }

  if (typeof message !== "string" || message.length === 0) {
    throw refuse("its message is empty");
  }

  if (new TextEncoder().encode(message).length > maximumMessageBytes) {
    throw refuse(
      "its message is over the 256 KB SNS limit." +
        " limitedReportNotificationMessage keeps lines under it",
    );
  }

  return { subject, message };
}
