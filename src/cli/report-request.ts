// Turning a report command line into one report period and S3 location.

import {
  defaultReportWeekStartsOn,
  type ReportPeriod,
  reportPeriodUnits,
  type ReportWeekday,
} from "../report-periods.js";
import type { CommandContext } from "./command.js";
import { UsageError } from "./failure.js";
import { chosen, summaryBucketFrom } from "./option-values.js";
import { reportUnitList } from "./report-help.js";
import { selectedReportPeriod } from "./report-period-selection.js";
import { summaryBucketVariable } from "./summary-help.js";

/** One report address read from the command line. */
export interface ReportRequest {
  readonly bucket: string;
  readonly region: string | undefined;
  readonly period: ReportPeriod;
  readonly compare: boolean;
}

/** Reads and validates the report command's arguments and options. */
export function reportRequestFrom(context: CommandContext): ReportRequest {
  refuseNonJson(context.options["output"]);

  const [unitText, selector, ...extra] = context.args;

  if (unitText === undefined || selector === undefined || extra.length > 0) {
    throw new UsageError(
      `report takes a unit and a date. For example,` +
        ` "rainlytics report month 2026-07".`,
      "report",
    );
  }

  const unit = reportPeriodUnits.find((value) => value === unitText);

  if (unit === undefined) {
    throw new UsageError(
      `The report unit must be ${reportUnitList}. Got ${JSON.stringify(unitText)}.`,
      "report",
    );
  }

  const bucket = summaryBucketFrom(context.options["summaries"]);

  if (bucket === undefined) {
    throw new UsageError(
      `Nothing has said where the reports are. Name the summaries bucket` +
        ` with --summaries, or put it in ${summaryBucketVariable}.` +
        ` RollupSummaries writes reports into that bucket.`,
      "report",
    );
  }

  const timeZone = chosen(context.options["time-zone"]) ?? "UTC";
  const weekStartsOn =
    (chosen(context.options["week-starts-on"]) as ReportWeekday | undefined) ??
    defaultReportWeekStartsOn;

  return {
    bucket,
    region: chosen(context.options["region"]),
    period: selectedReportPeriod(unit, selector, timeZone, weekStartsOn),
    compare: context.options["compare"] === true,
  };
}

/** Refuses table and CSV before a report makes an S3 request. */
function refuseNonJson(output: unknown): void {
  const asked = chosen(output);

  if (asked !== undefined && asked !== "json") {
    throw new UsageError(
      `report writes its versioned document as JSON. Got --output ${asked}.`,
      "report",
    );
  }
}
