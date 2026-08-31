// The public calendar period shapes used by reports.

/** The calendar units a report can cover. */
export type ReportPeriodUnit = "day" | "week" | "month" | "year";

/** Calendar units from shortest to longest. */
export const reportPeriodUnits: readonly ReportPeriodUnit[] = [
  "day",
  "week",
  "month",
  "year",
];

/** A weekday used to say where a report week starts. */
export type ReportWeekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

/** ISO 8601's first day of a week. */
export const defaultReportWeekStartsOn: ReportWeekday = "monday";

/** A calendar period as a caller addresses it. */
export interface ReportPeriodRequest {
  /** The calendar unit containing {@link at}. */
  readonly unit: ReportPeriodUnit;

  /** Any instant inside the period. */
  readonly at: Date;

  /** The IANA time zone whose calendar defines the boundaries. */
  readonly timeZone: string;

  /** The first day of a week. Ignored by the other units. */
  readonly weekStartsOn?: ReportWeekday | undefined;
}

interface ReportPeriodBase {
  /** The calendar unit this period covers. */
  readonly unit: ReportPeriodUnit;

  /** The canonical IANA time zone used for the calendar. */
  readonly timeZone: string;

  /** The first local calendar date in the period. */
  readonly startsOn: string;

  /** The first local calendar date after the period. */
  readonly endsBefore: string;

  /** The first instant in the period, in ISO 8601 and UTC. */
  readonly from: string;

  /** The first instant after the period, in ISO 8601 and UTC. */
  readonly until: string;
}

/** A closed calendar day, month or year. */
export interface ReportPeriodWithoutWeek extends ReportPeriodBase {
  readonly unit: "day" | "month" | "year";
}

/** A closed calendar week, including the choice that defines it. */
export interface ReportWeekPeriod extends ReportPeriodBase {
  readonly unit: "week";

  /** The weekday this week opens on. */
  readonly weekStartsOn: ReportWeekday;
}

/** One closed calendar day, week, month or year. */
export type ReportPeriod = ReportPeriodWithoutWeek | ReportWeekPeriod;
