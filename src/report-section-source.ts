// The continuous summary span behind one report section.

import type { ReportPeriod } from "./report-periods.js";
import type { ReportSectionSource } from "./report-section-types.js";
import type { SummarySpan } from "./summary-windows.js";

/** The source metadata for a set of stored windows. */
export function reportSectionSource(
  spans: readonly SummarySpan[],
  period: ReportPeriod,
): ReportSectionSource {
  if (spans.length === 0) {
    return {
      from: period.from,
      until: period.from,
      summaries: 0,
      complete: false,
    };
  }

  const ordered = spans.map((span) => {
    assertInstant(span.from, "summary source start");
    assertInstant(span.until, "summary source end");

    if (Date.parse(span.until) <= Date.parse(span.from)) {
      throw new RangeError(
        `A summary source must end after it starts. It runs from` +
          ` ${span.from} until ${span.until}.`,
      );
    }

    return span;
  });
  // ES2021 is the package target, and Array#toSorted arrived in ES2023.
  // oxlint-disable-next-line unicorn/no-array-sort
  ordered.sort((left, right) => left.from.localeCompare(right.from));
  const [first, ...rest] = ordered as [SummarySpan, ...SummarySpan[]];
  let last = first;
  for (const span of rest) {
    last = span;
  }

  const adjacent = ordered.every(
    (span, index) => index === 0 || ordered[index - 1]?.until === span.from,
  );

  return {
    from: first.from,
    until: last.until,
    summaries: ordered.length,
    complete:
      adjacent && first.from === period.from && last.until === period.until,
  };
}

/** The source metadata for one query over the whole report period. */
export function reportPeriodQuerySource(
  spans: readonly SummarySpan[],
  period: ReportPeriod,
): ReportSectionSource {
  if (spans.length !== 1) {
    throw new RangeError(
      `A period query has one source span. Got ${String(spans.length)}.`,
    );
  }

  const [span] = spans;

  if (span === undefined) {
    throw new RangeError("A period query has one source span. Got none.");
  }

  assertInstant(span.from, "period query source start");
  assertInstant(span.until, "period query source end");

  return {
    from: span.from,
    until: span.until,
    summaries: 0,
    queries: 1,
    complete: span.from === period.from && span.until === period.until,
  };
}

/** Refuses source text that is not canonical ISO 8601 UTC. */
function assertInstant(instant: string, subject: string): void {
  const parsed = new Date(instant);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== instant) {
    throw new RangeError(
      `${sentenceSubject(subject)} ${JSON.stringify(instant)} is not` +
        " an ISO 8601 UTC instant.",
    );
  }
}

/** A subject with an initial capital for an error sentence. */
function sentenceSubject(subject: string): string {
  return `${subject.slice(0, 1).toUpperCase()}${subject.slice(1)}`;
}
