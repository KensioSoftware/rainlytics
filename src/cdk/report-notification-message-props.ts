// A site's own report notification publisher, checked at synthesis.

/** A site's own publisher entry, written with `reportNotificationHandler`. */
export interface ReportNotificationMessageProps {
  /**
   * Path to the TypeScript or JavaScript file that exports the handler.
   * Rainlytics bundles it with esbuild through `NodejsFunction`, so the site
   * needs esbuild installed.
   */
  readonly entry: string;

  /**
   * The exported name of the handler in `entry`.
   *
   * @default handler
   */
  readonly handler?: string | undefined;

  /**
   * Environment values the message function reads, such as a table name.
   * Names starting `RAINLYTICS_` are reserved for the publisher's own.
   */
  readonly environment?: Readonly<Record<string, string>> | undefined;
}

/** Refuses a site publisher that would shadow the publisher's own settings. */
export function assertReportNotificationMessage(
  message: ReportNotificationMessageProps,
): void {
  if (message.entry.trim() === "") {
    throw new Error("A report notification message entry cannot be blank.");
  }

  for (const name of Object.keys(message.environment ?? {})) {
    if (name.startsWith("RAINLYTICS_")) {
      throw new Error(
        `The report notification message environment cannot set ${name}.` +
          " Names starting RAINLYTICS_ belong to the publisher.",
      );
    }
  }
}
