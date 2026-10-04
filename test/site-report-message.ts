/**
 * A site's own report notification publisher, as a consuming site writes it.
 *
 * The construct tests name this file as `reportNotifications.message.entry`,
 * so it is bundled by `NodejsFunction` and run as the deployed publisher. It
 * keeps the default pageviews lines, adds a figure read from SSM to stand in
 * for the site's own database, and imports through the same entry point a
 * site would.
 */

import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import {
  reportNotificationHandler,
  reportNotificationHeading,
  reportNotificationSectionLines,
} from "../src/notifications/index.js";

const ssm = new SSMClient({});

export const handler = reportNotificationHandler({
  message: async ({ manifest, reports }) => {
    const found = await ssm.send(
      new GetParameterCommand({ Name: process.env["SIGN_UPS_PARAMETER"] }),
    );
    const lines = [`Sign-ups: ${found.Parameter?.Value ?? "unknown"}`];

    for (const report of reports) {
      const index = report.current.sections.findIndex(
        (section) => section.question.name === "pageviews",
      );
      const section = report.current.sections[index];
      if (section !== undefined) {
        lines.push(
          reportNotificationHeading(report.current),
          ...reportNotificationSectionLines(
            section,
            report.comparison?.sections[index],
            1,
          ),
        );
      }
    }

    return {
      subject: `Site digest for ${manifest.closingDay.startsOn}`,
      message: lines.join("\n"),
    };
  },
});
