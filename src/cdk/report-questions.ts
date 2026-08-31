// Turning configured rollups into the questions one report run carries.

import type { ReportCompositionRule } from "../report-section-types.js";
import type { Rollup } from "../rollups.js";
import type { SummaryGranularity } from "../summary-windows.js";
import {
  reportQuestionRun,
  type ReportQuestionRun,
} from "../functions/report-run.js";
import type { LogDataset } from "../dataset.js";
import type { SavedRollupRequest } from "./rollup-queries.js";
import { summaryRuns } from "./summary-questions.js";

/** What the report questions of one deployment are built from. */
export interface ReportQuestions {
  readonly rollups: readonly Rollup[];
  readonly granularities: readonly SummaryGranularity[];
  readonly dataset: LogDataset;
  readonly requests?: Readonly<Record<string, SavedRollupRequest>> | undefined;
}

/** Every configured rollup, with its report calculation rule. */
export function reportQuestions(
  configured: ReportQuestions,
): readonly ReportQuestionRun[] {
  const runs = summaryRuns({
    rollups: configured.rollups,
    granularities: ["daily"],
    dataset: configured.dataset,
    ...(configured.requests === undefined
      ? {}
      : { requests: configured.requests }),
  });

  return configured.rollups.map((rollup, index) => {
    const run = runs[index];

    if (run === undefined) {
      throw new Error(`No scheduled query was built for ${rollup.name}.`);
    }

    const calculation = canCompose(rollup) ? "summaries" : "period-query";

    return reportQuestionRun(
      run,
      compositionRule(rollup),
      calculation,
      calculation === "summaries" ? rollup.totals : undefined,
    );
  });
}

/** Whether stored summaries carry enough serialisable arithmetic. */
function canCompose(rollup: Rollup): boolean {
  return rollup.totals !== undefined && rollup.totals.recomputed === undefined;
}

/** The accuracy rule a section follows when it uses stored summaries. */
function compositionRule(rollup: Rollup): ReportCompositionRule {
  if (rollup.isRanked) {
    return "ranked";
  }

  return rollup.totals === undefined ? "percentile" : "additive";
}
