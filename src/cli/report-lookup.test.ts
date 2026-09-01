import {
  assertIdentical,
  assertInstanceOf,
  assertObjectEquals,
  assertStringIncludes,
  assertStringNotIncludes,
} from "@kensio/smartass";
import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimAws } from "@kensio/yulin";
import { SimSdk } from "@kensio/yulin/sdk";
import { describe, it, vi } from "vitest";

import { reportSchemaVersion } from "../report-document.js";
import { reportKey } from "../report-key.js";
import { previousReportPeriod } from "../report-comparisons.js";
import { reportPeriod, type ReportPeriod } from "../report-periods.js";
import { rainlyticsCommands } from "./command.js";
import { readReport } from "./report-lookup.js";
import { runCli } from "./run.js";

describe("reading one calendar report object", () => {
  const period = reportPeriod(
    {
      unit: "day",
      at: new Date("2026-08-23T12:00:00.000Z"),
      timeZone: "UTC",
    },
    new Date("2026-08-24T00:00:00.000Z"),
  );

  const completeDocument = (forPeriod: ReportPeriod = period) => ({
    schemaVersion: reportSchemaVersion,
    period: forPeriod,
    sourceCoverage: {
      from: forPeriod.from,
      until: forPeriod.until,
      complete: true,
    },
    computedAt: new Date(Date.parse(forPeriod.until) + 1_800_000).toISOString(),
    sections: [],
  });

  const failureOf = async (action: () => Promise<unknown>): Promise<Error> => {
    try {
      await action();
    } catch (error) {
      assertInstanceOf(error, Error);
      return error;
    }

    throw new Error("Expected the report read to fail.");
  };

  const bucketIn = async (simAws: SimAws): Promise<string> => {
    const bucket = `rainlytics-summaries-${faker.string.uuid()}`;
    await simAws
      .region("us-east-1")
      .s3()
      .createBucket({ input: { Bucket: bucket } });
    return bucket;
  };

  it("preserves a supported complete document", async () => {
    // Given a complete versioned report in a simulated S3 bucket.
    const simAws = new SimAws();
    const bucket = await bucketIn(simAws);
    const document = completeDocument();
    await simAws
      .region("us-east-1")
      .s3()
      .putObject({
        input: {
          Bucket: bucket,
          Key: reportKey(period),
          Body: JSON.stringify(document),
        },
      });
    using simSdk = new SimSdk({ simAws });
    simSdk.intercept(S3Client);

    // When the command's reader fetches the selected period.
    const read = await readReport(bucket, "us-east-1", period);

    // Then the document is unchanged and its S3 metadata is retained.
    assertObjectEquals(read.document, document);
    assertInstanceOf(read.lastModified, Date);
  });

  it("reads the preceding report and writes a structured comparison", async () => {
    // Given adjacent report documents in a simulated summaries bucket.
    const simAws = new SimAws();
    const bucket = await bucketIn(simAws);
    const previousPeriod = previousReportPeriod(period);
    for (const forPeriod of [period, previousPeriod]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await simAws
        .region("us-east-1")
        .s3()
        .putObject({
          input: {
            Bucket: bucket,
            Key: reportKey(forPeriod),
            Body: JSON.stringify(completeDocument(forPeriod)),
          },
        });
    }
    using simSdk = new SimSdk({ simAws });
    simSdk.intercept(S3Client);

    // When the shipped command reads the selected report with --compare.
    let stdout = "";
    let stderr = "";
    const code = await runCli({
      argv: [
        "report",
        "day",
        period.startsOn,
        "--compare",
        "--summaries",
        bucket,
        "--region",
        "us-east-1",
      ],
      commands: rainlyticsCommands,
      io: {
        out: (value) => {
          stdout += value;
        },
        error: (value) => {
          stderr += value;
        },
        outIsTerminal: false,
      },
    });

    // Then stdout remains one JSON document and the read costs two S3 GETs.
    assertIdentical(code, 0);
    assertObjectEquals(JSON.parse(stdout), {
      kind: "calendar-report-comparison",
      schemaVersion: 1,
      reports: {
        current: {
          schemaVersion: reportSchemaVersion,
          period,
          sourceCoverage: {
            from: period.from,
            until: period.until,
            complete: true,
          },
          computedAt: completeDocument().computedAt,
        },
        previous: {
          schemaVersion: reportSchemaVersion,
          period: previousPeriod,
          sourceCoverage: {
            from: previousPeriod.from,
            until: previousPeriod.until,
            complete: true,
          },
          computedAt: completeDocument(previousPeriod).computedAt,
        },
      },
      sections: [],
    });
    assertStringIncludes(stderr, "2 GETs");
    assertStringIncludes(stderr, reportKey(period));
    assertStringIncludes(stderr, reportKey(previousPeriod));
    assertStringNotIncludes(stderr, "Athena");
  });

  it("explains a report that has not been written", async () => {
    // Given an empty simulated summaries bucket.
    const simAws = new SimAws();
    const bucket = await bucketIn(simAws);
    using simSdk = new SimSdk({ simAws });
    simSdk.intercept(S3Client);

    // When the selected report is read through the shipped command.
    let stdout = "";
    let stderr = "";
    const code = await runCli({
      argv: [
        "report",
        "day",
        "2026-08-23",
        "--summaries",
        bucket,
        "--region",
        "us-east-1",
      ],
      commands: rainlyticsCommands,
      io: {
        out: (text) => {
          stdout += text;
        },
        error: (text) => {
          stderr += text;
        },
        outIsTerminal: false,
      },
    });

    // Then the missing period, bucket and absence of an Athena fallback are
    // all explicit, and standard output stays empty.
    assertIdentical(code, 1);
    assertIdentical(stdout, "");
    assertStringIncludes(stderr, "No day report starting 2026-08-23");
    assertStringIncludes(stderr, bucket);
    assertStringIncludes(stderr, "never falls back to Athena");
  });

  it("refuses an incomplete stored report", async () => {
    // Given a document whose source does not cover the selected day.
    const simAws = new SimAws();
    const bucket = await bucketIn(simAws);
    const document = {
      ...completeDocument(),
      sourceCoverage: {
        from: period.from,
        until: period.until,
        complete: false,
      },
    };
    await simAws
      .region("us-east-1")
      .s3()
      .putObject({
        input: {
          Bucket: bucket,
          Key: reportKey(period),
          Body: JSON.stringify(document),
        },
      });
    using simSdk = new SimSdk({ simAws });
    simSdk.intercept(S3Client);

    // When it is read.
    const error = await failureOf(async () =>
      readReport(bucket, "us-east-1", period),
    );

    // Then no partial document can reach standard output.
    assertStringIncludes(error.message, "is incomplete");
    assertStringIncludes(error.message, "did not run Athena");
  });

  it("refuses an unsupported report schema", async () => {
    // Given a future document under the current version's key.
    const simAws = new SimAws();
    const bucket = await bucketIn(simAws);
    const document = {
      ...completeDocument(),
      schemaVersion: reportSchemaVersion + 1,
    };
    await simAws
      .region("us-east-1")
      .s3()
      .putObject({
        input: {
          Bucket: bucket,
          Key: reportKey(period),
          Body: JSON.stringify(document),
        },
      });
    using simSdk = new SimSdk({ simAws });
    simSdk.intercept(S3Client);

    // When it is read.
    const error = await failureOf(async () =>
      readReport(bucket, "us-east-1", period),
    );

    // Then the stored and supported versions are both named.
    assertStringIncludes(
      error.message,
      `schema version ${String(reportSchemaVersion + 1)}`,
    );
    assertStringIncludes(error.message, `reads ${String(reportSchemaVersion)}`);
  });

  it("explains denied and other S3 failures", async () => {
    // Given one permission refusal and one service failure from S3.
    const send = vi.spyOn(S3Client.prototype, "send");
    send.mockRejectedValueOnce(
      Object.assign(new Error("Access Denied"), { name: "AccessDenied" }),
    );

    // When each report is read.
    const denied = await failureOf(async () =>
      readReport("private-reports", "us-east-1", period),
    );
    send.mockRejectedValueOnce(
      Object.assign(new Error("PermanentRedirect"), {
        name: "PermanentRedirect",
      }),
    );
    const redirected = await failureOf(async () =>
      readReport("elsewhere-reports", "us-east-1", period),
    );

    // Then the permission names its action, while the other failure points to
    // the bucket and region options.
    assertStringIncludes(denied.message, "s3:GetObject");
    assertStringIncludes(denied.message, "private-reports");
    assertStringIncludes(redirected.message, "PermanentRedirect");
    assertStringIncludes(redirected.message, "--region");
  });

  it("recognises the SDK's alternate missing-object name", async () => {
    // Given the alternate missing response some S3-compatible endpoints use.
    vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { name: "NotFound" }),
    );

    // When the report is read.
    const error = await failureOf(async () =>
      readReport("empty-reports", "us-east-1", period),
    );

    // Then it receives the useful missing-report explanation.
    assertStringIncludes(error.message, "No day report");
  });

  it("refuses an S3 response with no body", async () => {
    // Given S3 metadata without the report document itself.
    vi.spyOn(S3Client.prototype, "send").mockResolvedValueOnce({} as never);

    // When the response is read with the SDK's default region chain.
    const error = await failureOf(async () =>
      readReport("bodyless-reports", undefined, period),
    );

    // Then the absent body is reported as an unsupported document.
    assertStringIncludes(error.message, "S3 returned no document body");
  });

  it("uses the document time when S3 omits LastModified", async () => {
    // Given a complete object whose response has no modification timestamp.
    const document = completeDocument();
    vi.spyOn(S3Client.prototype, "send").mockResolvedValueOnce({
      Body: {
        transformToString: () => Promise.resolve(JSON.stringify(document)),
      },
    } as never);

    // When it is read.
    const read = await readReport("reports", "us-east-1", period);

    // Then the document's computation time supplies the diagnostic age.
    assertIdentical(read.lastModified.toISOString(), document.computedAt);
  });
});
