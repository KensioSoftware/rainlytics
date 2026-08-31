import { assertIdentical, assertStringIncludes } from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { queryFailure } from "./query-run.js";

describe("explaining a query Athena would not finish", () => {
  it("says what to do about the workgroup's cutoff", () => {
    // Given the refusal a bytes-scanned cutoff produces.
    const failure = queryFailure(
      "Bytes scanned limit was exceeded. The query scanned 20000000 bytes," +
        " and workgroup rainlytics allows 10000000 per query.",
      "rainlytics",
    );

    // Then Athena's own words come first, so the numbers are the ones it
    // reported.
    assertStringIncludes(failure.message, "The query scanned 20000000 bytes");

    // And the limit is explained as something somebody chose, with the two
    // ways out. A ceiling that reads as a wall is one people work around by
    // taking it off.
    assertStringIncludes(failure.message, "Narrow the query");
    assertStringIncludes(failure.message, "distributionid, year, month, day");
    assertStringIncludes(failure.message, "bytesScannedCutoff");
    assertStringIncludes(failure.message, "rainlytics workgroup");
  });

  it("passes any other reason through untouched", () => {
    // Given a failure that has nothing to do with the cutoff.
    const reason = faker.lorem.sentence();

    // Then it comes back as Athena wrote it. This command should not stand
    // between a person and what the service told them.
    assertIdentical(queryFailure(reason, "rainlytics").message, reason);
  });

  it("says so where Athena gave no reason at all", () => {
    // Given a failed execution carrying no reason, which the SDK's types
    // allow.
    const failure = queryFailure(undefined, "rainlytics");

    // Then the message says that rather than being empty, which would exit
    // non-zero with nothing on standard error.
    assertIdentical(failure.message, "Athena gave no reason.");
  });
});
