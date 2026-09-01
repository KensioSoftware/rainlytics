// Lambda environment values for one calendar report writer.

import { reportNotificationEnvironment } from "../functions/report-notification-deployment.js";
import { summaryEnvironment } from "../functions/summary-deployment.js";
import type { ReportPeriodUnit } from "../report-periods.js";
import type { LogTable } from "./log-table.js";
import type { QueryWorkgroup } from "./query-workgroup.js";
import type { SummariesBucket } from "./summary-bucket.js";

/** Resources and optional notification periods handed to the report Lambda. */
export function reportFunctionEnvironment(input: {
  readonly table: LogTable;
  readonly workgroup: QueryWorkgroup;
  readonly bucket: SummariesBucket;
  readonly saltParameter: string;
  readonly notificationPeriods: readonly ReportPeriodUnit[] | undefined;
}): Readonly<Record<string, string>> {
  return {
    [summaryEnvironment.database]: input.table.dataset.databaseName,
    [summaryEnvironment.workgroup]: input.workgroup.workgroupName,
    [summaryEnvironment.bucket]: input.bucket.bucketName,
    [summaryEnvironment.visitorSaltParameter]: input.saltParameter,
    ...(input.notificationPeriods === undefined
      ? {}
      : {
          [reportNotificationEnvironment.periods]: JSON.stringify(
            input.notificationPeriods,
          ),
        }),
  };
}
