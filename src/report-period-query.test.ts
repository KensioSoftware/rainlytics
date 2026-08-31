import {
  assertIdentical,
  assertStringIncludes,
  assertStringMatches,
  assertStringNotIncludes,
  assertThrowsError,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { reportPeriod } from "./report-periods.js";
import { periodQuerySpan, periodQuerySql } from "./report-period-query.js";
import { windowPlaceholder } from "./rollup-rows.js";

describe("a query over one calendar report period", () => {
  const aPeriod = () =>
    reportPeriod(
      {
        unit: "day",
        at: new Date("2026-08-24T12:00:00.000Z"),
        timeZone: "UTC",
      },
      new Date("2026-08-25T00:30:00.000Z"),
    );

  it("fills every window placeholder with the period partitions", () => {
    // Given a generated rollup query carrying the guarded placeholder twice.
    const template = `SELECT 1 WHERE ${windowPlaceholder} OR ${windowPlaceholder}`;

    // When the calendar period is applied.
    const sql = periodQuerySql(template, aPeriod());

    // Then the query names the closed date and carries no unbounded marker.
    assertStringIncludes(sql, "year IN ('2026')");
    assertStringIncludes(sql, "day IN ('24')");
    assertStringNotIncludes(sql, windowPlaceholder);
  });

  it("uses the report boundaries as one exact source span", () => {
    const period = aPeriod();
    const span = periodQuerySpan(period);

    assertIdentical(span.from, period.from);
    assertIdentical(span.until, period.until);
  });

  it("refuses a query that could scan the whole table", () => {
    const error = assertThrowsError(() =>
      periodQuerySql("SELECT 1", aPeriod()),
    );
    assertStringMatches(error.message, /which period it reads/u);
  });
});
