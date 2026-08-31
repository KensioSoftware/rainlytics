// Turning an Athena outcome into report data or a useful failure.

import type { AthenaOutcome } from "../athena/athena-outcome.js";
import type { ReportPeriod } from "../report-periods.js";
import type { ReportRowsValue } from "../report-section-types.js";
import type { SummaryCell, SummaryRow } from "../rollup-summaries.js";
import type { ReportDeployment } from "./report-deployment.js";
import { summaryFailure } from "./summary-failure.js";

/** Rows stored in a report, preserving Athena nulls. */
export function reportRowsValue(outcome: AthenaOutcome): ReportRowsValue {
  return {
    type: "rows",
    columns: outcome.columns.map((column) => column.name),
    rows: outcome.rows.map(storedRow),
  };
}

function storedRow(
  row: Readonly<Record<string, string | undefined>>,
): SummaryRow {
  return Object.fromEntries(
    Object.entries(row).map(([column, cell]) => [column, cell ?? absent]),
  );
}

// oxlint-disable-next-line unicorn/no-null
const absent: SummaryCell = null;

/** Refuses an Athena outcome that holds no answer for the report. */
export function assertReportQuerySucceeded(
  outcome: AthenaOutcome,
  subject: string,
  period: ReportPeriod,
  deployment: ReportDeployment,
): asserts outcome is AthenaOutcome & { readonly state: "SUCCEEDED" } {
  if (outcome.state !== "SUCCEEDED") {
    throw summaryFailure(
      outcome,
      `${subject} for the ${period.unit} starting ${period.startsOn}`,
      deployment.workgroup,
    );
  }
}
