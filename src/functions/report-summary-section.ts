// One report section composed from stored summary documents.

import type { ReportPeriod } from "../report-periods.js";
import type { ReportSection } from "../report-section-types.js";
import { reportSection } from "../report-sections.js";
import type { RollupSummary, SummaryQuestion } from "../rollup-summaries.js";
import { neverComputed, summaryKey } from "../rollup-summaries.js";
import { totalledRows } from "../summary-totals.js";
import type { SummaryWindow } from "../summary-windows.js";
import { summarySpan } from "../summary-windows.js";
import type { ReportQuestionRun } from "./report-run.js";
import type { ReportStore } from "./report-store.js";
import { isExpectedSummary } from "./report-summary-validation.js";

/** Rows calculated from the valid summaries under the expected keys. */
export async function summarizedRowsSection(
  period: ReportPeriod,
  question: ReportQuestionRun,
  windows: readonly SummaryWindow[],
  store: ReportStore,
): Promise<ReportSection> {
  const summaries = await sourceSummaries(question.question, windows, store);
  const rows =
    summaries.length === 0
      ? []
      : totalledRows(
          summaries,
          question.totals ?? { added: [] },
          question.rule === "ranked" ? question.question.limit : undefined,
        );

  return reportSection(
    {
      question: question.question,
      rule: question.rule,
      sources: summaries.map((summary) => summary.window),
      value: {
        type: "rows",
        columns: summaries[0]?.columns ?? [],
        rows,
      },
    },
    period,
  );
}

/** Valid summaries, with absent and mismatched objects left as gaps. */
async function sourceSummaries(
  question: SummaryQuestion,
  windows: readonly SummaryWindow[],
  store: ReportStore,
): Promise<readonly RollupSummary[]> {
  const found = await store.read(
    windows.map((window) => summaryKey(question, window)),
  );
  const summaries: RollupSummary[] = [];
  let columns: readonly string[] | undefined;

  for (const [index, candidate] of found.entries()) {
    const window = windows[index];

    if (
      window === undefined ||
      candidate === neverComputed ||
      !isExpectedSummary(candidate, question, summarySpan(window))
    ) {
      continue;
    }

    if (
      columns !== undefined &&
      JSON.stringify(candidate.columns) !== JSON.stringify(columns)
    ) {
      continue;
    }

    columns = candidate.columns;
    summaries.push(candidate);
  }

  return summaries;
}
