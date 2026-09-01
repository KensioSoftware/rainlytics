// The options and help for `rainlytics report`.

import {
  defaultReportWeekStartsOn,
  reportPeriodUnits,
  type ReportWeekday,
} from "../report-periods.js";
import type { CliOption } from "./option.js";
import { regionOption } from "./query-help.js";
import { summariesOption } from "./summary-help.js";
import { listOf } from "./text-layout.js";

/** Weekdays accepted by the report calendar. */
export const reportWeekdays: readonly ReportWeekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const reportTimeZoneOption: CliOption = {
  name: "time-zone",
  short: "z",
  type: "string",
  valueName: "iana-name",
  description:
    `The IANA time zone whose calendar selects the report. Defaults to UTC.` +
    ` Use the reportTimeZone passed to RollupSummaries when it differs.`,
};

export const reportWeekStartsOnOption: CliOption = {
  name: "week-starts-on",
  type: "string",
  valueName: "weekday",
  choices: reportWeekdays,
  description:
    `The first day of a weekly report. ${listOf(reportWeekdays)}. Defaults` +
    ` to ${defaultReportWeekStartsOn}, matching RollupSummaries. Other` +
    ` report units ignore it.`,
};

export const reportCompareOption: CliOption = {
  name: "compare",
  type: "boolean",
  description:
    `Compare the selected report with the preceding calendar period.` +
    ` This reads one additional report object and keeps JSON output.`,
};

export const reportOptions: readonly CliOption[] = [
  summariesOption,
  regionOption,
  reportTimeZoneOption,
  reportWeekStartsOnOption,
  reportCompareOption,
];

export const reportDescription = `\
Reads one precomputed calendar report from the summaries bucket and writes its
versioned JSON document. It never runs Athena and never falls back to a query
when the report is missing or incomplete.

The first argument is day, week, month or year. The second identifies a date
inside that report. Day and week take YYYY-MM-DD. Month also accepts YYYY-MM,
and year also accepts YYYY.

  rainlytics report day 2026-08-30
  rainlytics report week 2026-08-24 --time-zone Europe/London
  rainlytics report month 2026-07 --compare
  rainlytics report year 2025

The time zone must match the RollupSummaries deployment. For a weekly report,
the first weekday must also match. These options are part of the stored report's
address. The command derives that address from the date and options, so a reader
does not have to calculate an S3 key.

Reports currently have JSON output only. Leave --output off or pass
--output json. The document goes to standard output. Pass --compare to derive
changes against the immediately preceding period. The comparison reads two
stored report objects. The bucket, object keys, object ages and S3 GET cost go
to standard error, which keeps piped JSON clean.

Credentials and the region come from the AWS SDK's default chain. --summaries
and --region override them in the same way they do for named questions.`;

/** The units as text for a command-line refusal. */
export const reportUnitList = listOf(reportPeriodUnits);
