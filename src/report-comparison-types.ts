// The derived shape produced by comparing two stored calendar reports.

import type { ReportSourceCoverage } from "./report-coverage.js";
import type { ReportDocument } from "./report-document.js";
import type { ReportPeriod } from "./report-periods.js";
import type { ReportSectionSource } from "./report-section-types.js";
import type { SummaryQuestion, SummaryRow } from "./rollup-summaries.js";

/** The current derived comparison shape. */
export const reportComparisonSchemaVersion = 1;

/** The arithmetic used to describe one metric's change. */
export type ReportMetricMeasure = "count" | "ratio" | "duration" | "percentile";

/** How movement in a metric is assessed. */
export type ReportMetricPreference =
  | "higher-is-better"
  | "lower-is-better"
  | "neutral";

/** A unit selected from the row that contains a metric. */
export interface ReportMetricRowUnits {
  readonly column: string;
  readonly values: Readonly<Record<string, string>>;
  readonly fallback: string;
}

/** How one numeric column in a report section can be compared. */
export interface ReportMetricDefinition {
  readonly column: string;
  readonly measure: ReportMetricMeasure;
  readonly unit: string | ReportMetricRowUnits;
  readonly preference: ReportMetricPreference;
}

/** How one report question's value can be compared. */
export interface ReportComparisonDefinition {
  readonly question: string;
  readonly valueType: "rows" | "visitor-count";
  readonly rowSet: "complete" | "ranked";
  readonly metrics: readonly ReportMetricDefinition[];
}

/** One side's document metadata. */
export interface ReportComparisonDocumentSource {
  readonly schemaVersion: number;
  readonly period: ReportPeriod;
  readonly sourceCoverage: ReportSourceCoverage | null;
  readonly computedAt: string;
}

/** One side's section metadata, without its potentially large value. */
export interface ReportComparisonSectionSource {
  readonly accuracy: "exact" | "approximate" | "unavailable";
  readonly composition:
    | "single-summary"
    | "period-query"
    | "additive"
    | "ranked-summaries"
    | "none";
  readonly source: ReportSectionSource | null;
}

/** The two source questions and section descriptions being compared. */
export interface ReportComparisonSectionSources {
  readonly questions: {
    readonly current: SummaryQuestion | null;
    readonly previous: SummaryQuestion | null;
  };
  readonly current: ReportComparisonSectionSource | null;
  readonly previous: ReportComparisonSectionSource | null;
}

/** Whether the current numeric value rose, fell or stayed level. */
export type ReportMetricTrend = "increase" | "decrease" | "unchanged";

/** What a metric preference says about its movement. */
export type ReportMetricAssessment =
  | "improvement"
  | "regression"
  | "unchanged"
  | "unrated";

/** A relative percentage or percentage-point change. */
export interface ReportMetricChange {
  readonly type: "relative-percent" | "percentage-points";
  readonly value: number | null;
  readonly reason?: "zero-baseline" | undefined;
}

/** A metric whose two numeric values can be compared. */
export interface AvailableReportMetricComparison {
  readonly status: "available";
  readonly row: SummaryRow;
  readonly metric: string;
  readonly measure: ReportMetricMeasure;
  readonly unit: string;
  readonly preference: ReportMetricPreference;
  readonly current: number;
  readonly previous: number;
  readonly difference: number;
  readonly change: ReportMetricChange;
  readonly trend: ReportMetricTrend;
  readonly assessment: ReportMetricAssessment;
}

/** Why a row or metric has no safe comparison. */
export type UnavailableReportMetricReason =
  | "ranked-row-absent"
  | "row-absent"
  | "metric-value-unavailable";

/** A metric for which one comparable numeric value is absent. */
export interface UnavailableReportMetricComparison {
  readonly status: "unavailable";
  readonly reason: UnavailableReportMetricReason;
  readonly row: SummaryRow;
  readonly metric: string;
  readonly measure: ReportMetricMeasure;
  readonly unit: string;
  readonly preference: ReportMetricPreference;
  readonly current: number | null;
  readonly previous: number | null;
}

/** One row metric in a report comparison. */
export type ReportMetricComparison =
  | AvailableReportMetricComparison
  | UnavailableReportMetricComparison;

/** A section whose values have comparison semantics. */
export interface AvailableReportSectionComparison extends ReportComparisonSectionSources {
  readonly status: "available";
  readonly valueType: "rows" | "visitor-count";
  readonly accuracy: "exact" | "approximate";
  readonly metrics: readonly ReportMetricComparison[];
}

/** Why two report sections cannot be compared. */
export type UnavailableReportSectionComparisonReason =
  | "section-absent"
  | "question-mismatch"
  | "section-unavailable"
  | "incomplete-source"
  | "value-type-mismatch"
  | "unsupported-question"
  | "columns-mismatch";

/** A section pair for which no metric comparison is safe. */
export interface UnavailableReportSectionComparison extends ReportComparisonSectionSources {
  readonly status: "unavailable";
  readonly reason: UnavailableReportSectionComparisonReason;
}

/** One section in a comparison result. */
export type ReportSectionComparison =
  | AvailableReportSectionComparison
  | UnavailableReportSectionComparison;

/** A derived comparison of adjacent stored calendar reports. */
export interface ReportComparison {
  readonly kind: "calendar-report-comparison";
  readonly schemaVersion: number;
  readonly reports: {
    readonly current: ReportComparisonDocumentSource;
    readonly previous: ReportComparisonDocumentSource;
  };
  readonly sections: readonly ReportSectionComparison[];
}

/** Input for deriving a comparison from two stored reports. */
export interface ReportComparisonInput {
  readonly current: ReportDocument;
  readonly previous: ReportDocument;

  /** Additional definitions, replacing a shipped definition with the same key. */
  readonly definitions?: readonly ReportComparisonDefinition[] | undefined;
}
