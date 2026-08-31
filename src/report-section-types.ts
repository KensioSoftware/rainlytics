// The discriminated values and accuracy labels in a report section.

import type {
  SummaryQuestion,
  SummaryRow,
  VisitorCount,
} from "./rollup-summaries.js";
import type { SummarySpan } from "./summary-windows.js";

/** How stored summary values can be combined for a report. */
export type ReportCompositionRule =
  | "additive"
  | "ranked"
  | "visitor-count"
  | "percentile";

/** Rows from a rollup question. */
export interface ReportRowsValue {
  readonly type: "rows";
  readonly columns: readonly string[];
  readonly rows: readonly SummaryRow[];
}

/** A distinct visitor count from one summary. */
export interface ReportVisitorValue {
  readonly type: "visitor-count";
  readonly count: VisitorCount;
}

/** The value an available report section carries. */
export type ReportSectionValue = ReportRowsValue | ReportVisitorValue;

/** The stored summaries behind one section. */
export interface ReportSectionSource {
  /** The first source instant. */
  readonly from: string;

  /** The first instant after the source. */
  readonly until: string;

  /** How many stored summaries supplied the value. */
  readonly summaries: number;

  /** Whether the summaries cover the report period without a gap. */
  readonly complete: boolean;
}

interface ReportSectionBase {
  /** The rollup question this section answers. */
  readonly question: SummaryQuestion;
}

/** A value read from one summary spanning the whole report period. */
interface ExactSingleSummarySection extends ReportSectionBase {
  readonly accuracy: "exact";
  readonly composition: "single-summary";
  readonly source: ReportSectionSource;
  readonly value: ReportSectionValue;
}

/** Rows whose counts add across a complete set of source summaries. */
interface ExactAdditiveReportSection extends ReportSectionBase {
  readonly accuracy: "exact";
  readonly composition: "additive";
  readonly source: ReportSectionSource;
  readonly value: ReportRowsValue;
}

/** A value whose stored data gives the exact report-period answer. */
export type ExactReportSection =
  | ExactSingleSummarySection
  | ExactAdditiveReportSection;

/** Ranked rows composed from several truncated summaries. */
export interface ApproximateReportSection extends ReportSectionBase {
  readonly accuracy: "approximate";
  readonly composition: "ranked-summaries";
  readonly source: ReportSectionSource;
  readonly value: ReportRowsValue;
}

/** Why stored data cannot safely answer a section. */
export type UnavailableReportReason =
  | "missing-rollup"
  | "incomplete-source"
  | "visitor-counts-do-not-compose"
  | "percentiles-do-not-compose";

/** A section the stored summaries cannot safely answer. */
export interface UnavailableReportSection extends ReportSectionBase {
  readonly accuracy: "unavailable";
  readonly composition: "none";
  readonly reason: UnavailableReportReason;
  readonly source: ReportSectionSource | null;
  readonly value: null;
}

/** One question's value and the accuracy of that value. */
export type ReportSection =
  | ExactReportSection
  | ApproximateReportSection
  | UnavailableReportSection;

/** Input for a section built from stored summaries. */
export interface AvailableReportSectionInput {
  readonly question: SummaryQuestion;
  readonly rule: ReportCompositionRule;
  readonly sources: readonly SummarySpan[];
  readonly value: ReportSectionValue;
}

/** Input for an optional rollup that was not stored. */
export interface MissingReportSectionInput {
  readonly question: SummaryQuestion;
  readonly rule: "missing";
}

/** The inputs from which a section's accuracy is decided. */
export type ReportSectionInput =
  | AvailableReportSectionInput
  | MissingReportSectionInput;
