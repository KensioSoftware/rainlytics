import { describe, expect, it } from "vitest";

import { bytesBilledMinimum } from "../athena-pricing.js";
import { inBytes, inDollars, scanReport } from "./query-report.js";

describe("saying what a query scanned", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1500, "1.50 KB"],
    [10_000_000, "10.0 MB"],
    [1_600_000_000, "1.60 GB"],
    [12_300_000_000_000, "12.3 TB"],
  ])("writes %i bytes as %s", (bytes, expected) => {
    // Given a byte count Athena reported.
    // Then it reads the way AWS writes one, in the decimal units it prices
    // and reports in.
    expect(inBytes(bytes)).toBe(expected);
  });

  it("keeps counting in terabytes past the largest unit it knows", () => {
    // Given a scan larger than the units above go.
    // Then it stays in terabytes rather than running off the end of the list.
    // Nothing Rainlytics stores gets here, and a number with no unit would be
    // worse than a big one.
    expect(inBytes(5_000_000_000_000_000)).toBe("5000.0 TB");
  });
});

describe("saying what a query cost", () => {
  it("shows cents where there are cents to see", () => {
    // Given a charge somebody would recognise on a bill.
    // Then it is written the way money is.
    expect(inDollars(1.5)).toBe("$1.50");
    expect(inDollars(0.01)).toBe("$0.01");
  });

  it("shows the order of magnitude below a cent", () => {
    // Given the charge for a small query, which is what most of these are.
    // Then it says so rather than rounding to nothing. Somebody deciding
    // whether to run it again wants the size of the number, and "$0.00"
    // would tell them it was free.
    expect(inDollars(0.00005)).toBe("$0.000050");
    expect(inDollars(0.008)).toBe("$0.0080");
  });
});

describe("the line a query leaves on standard error", () => {
  it("names the minimum where the query was under it", () => {
    // Given a query that read almost nothing, which is what a well
    // partitioned one does.
    const report = scanReport(512, 300);

    // Then it says what was read, what was billed, and what that came to.
    // Athena bills ten million bytes whatever a query reads, so a report
    // quoting 512 bytes alone would make the query look free.
    expect(report).toContain("Scanned 512 B in 0.3s");
    expect(report).toContain("billed as 10.0 MB (the per-query minimum)");
    expect(report).toContain("About $0.000050");
  });

  it("leaves the minimum out where the query went past it", () => {
    // Given a query that read more than the minimum.
    const report = scanReport(bytesBilledMinimum * 100, 4200);

    // Then there is nothing to explain, and the line says what it scanned.
    expect(report).toContain("Scanned 1.00 GB in 4.2s.");
    expect(report).not.toContain("minimum");
  });

  it("says nothing about time where Athena reported none", () => {
    // Given an execution carrying no duration, which is what a query that
    // never ran comes back as.
    const report = scanReport(512, undefined);

    // Then the rest of the line still stands.
    expect(report).toBe(
      "Scanned 512 B, billed as 10.0 MB (the per-query minimum)." +
        " About $0.000050.\n",
    );
  });
});
