// Where the report notification jobs read their deployment settings.

import type { ReportPeriodUnit } from "../report-periods.js";

/** Lambda environment names shared by the writer and notifier. */
export const reportNotificationEnvironment = {
  periods: "RAINLYTICS_REPORT_NOTIFICATION_PERIODS",
  topicArn: "RAINLYTICS_REPORT_NOTIFICATION_TOPIC_ARN",
  questions: "RAINLYTICS_REPORT_NOTIFICATION_QUESTIONS",
  maxRowsPerQuestion: "RAINLYTICS_REPORT_NOTIFICATION_MAX_ROWS",
  subjectPrefix: "RAINLYTICS_REPORT_NOTIFICATION_SUBJECT_PREFIX",
} as const;

/** The notification settings one calendar report writer needs. */
export interface ReportWriterNotificationDeployment {
  readonly periods: readonly ReportPeriodUnit[];
}

/** The resources and formatting settings used by the notification Lambda. */
export interface ReportNotificationDeployment {
  readonly bucket: string;
  readonly topicArn: string;
  readonly questions?: readonly string[] | undefined;
  readonly maxRowsPerQuestion: number;
  readonly subjectPrefix: string;
}

/** Reads optional notification periods for the calendar report writer. */
export function reportWriterNotificationDeploymentFrom(
  environment: Readonly<Record<string, string | undefined>>,
): ReportWriterNotificationDeployment | undefined {
  const encoded = environment[reportNotificationEnvironment.periods];
  if (encoded === undefined) {
    return undefined;
  }

  return {
    periods: parsedStringArray(encoded, "calendar periods"),
  } as ReportWriterNotificationDeployment;
}

/** Reads the notifier's deployment out of its Lambda environment. */
export function reportNotificationDeploymentFrom(
  environment: Readonly<Record<string, string | undefined>>,
  bucketEnvironmentName: string,
): ReportNotificationDeployment {
  const questions = required(
    environment,
    reportNotificationEnvironment.questions,
  );
  const maxRows = Number(
    required(environment, reportNotificationEnvironment.maxRowsPerQuestion),
  );

  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100) {
    throw new Error(
      `The report notification job received an invalid row limit` +
        ` ${JSON.stringify(maxRows)}. RollupSummaries sets it.`,
    );
  }

  return {
    bucket: required(environment, bucketEnvironmentName),
    topicArn: required(environment, reportNotificationEnvironment.topicArn),
    ...(questions === ""
      ? {}
      : { questions: parsedStringArray(questions, "questions") }),
    maxRowsPerQuestion: maxRows,
    subjectPrefix: required(
      environment,
      reportNotificationEnvironment.subjectPrefix,
    ),
  };
}

/** Parses one environment JSON array whose values are all strings. */
function parsedStringArray(
  encoded: string,
  subject: string,
): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error(
      `The report notification job received malformed ${subject}.` +
        " RollupSummaries sets them.",
    );
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((value) => typeof value === "string" && value !== "")
  ) {
    throw new Error(
      `The report notification job received invalid ${subject}.` +
        " RollupSummaries sets them.",
    );
  }

  return parsed as string[];
}

/** Gets one required Lambda environment value. */
function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const found = environment[name];

  if (found === undefined) {
    throw new Error(
      `The report notification job needs ${name} in its environment.` +
        " RollupSummaries sets it.",
    );
  }

  return found;
}
