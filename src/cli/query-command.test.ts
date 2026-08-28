import { gzipSync } from "node:zlib";

import { AthenaClient } from "@aws-sdk/client-athena";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { type App, CfnOutput, Size, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { readingAthenaCaller } from "#test/reading-athena-caller.js";
import { deployStacks, simStartedAt } from "#test/simulated-deployment.js";

import { CloudFrontLogDelivery } from "../cdk/log-delivery.js";
import { LogBucket } from "../cdk/log-bucket.js";
import { LogTable } from "../cdk/log-table.js";
import { QueryWorkgroup } from "../cdk/query-workgroup.js";
import { partitionPrefix } from "../partitions.js";
import { rainlyticsCommands } from "./command.js";
import { runCli } from "./run.js";
import { summaryBucketVariable } from "./summary-help.js";

describe("rainlytics query", () => {
  /**
   * The interception in force, so the next deployment can take it off first.
   *
   * `SimSdk` refuses to intercept a client that is already intercepted, and
   * the command builds its own client, so the target has to be the class.
   * Restoring here rather than in a teardown hook keeps each case readable on
   * its own, which is what the hook would have cost.
   */
  let intercepted: SimSdk | undefined;

  /** What one run of the CLI wrote, and what it exited with. */
  interface Run {
    readonly code: number;
    readonly out: string;
    readonly error: string;
  }

  /**
   * The readable half of the pipeline in a simulated account, with the AWS
   * SDK pointed at it.
   *
   * Everything the command touches is real except the account behind it. The
   * CLI parses its own arguments, builds its own `AthenaClient`, and sends
   * commands that Yulin routes into simulated Athena, Glue and S3. What is
   * being tested is the command, not a description of one.
   */
  const deployAnalytics = async (options: { readonly cutoff?: Size } = {}) => {
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;

    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "AnalyticsStack", {
          env: { account, region: "us-east-1" },
        });
        const logs = new LogBucket(stack, "RainlyticsLogs", {
          bucketName: logBucketName,
        });
        const distribution = new Distribution(stack, "Site", {
          defaultBehavior: { origin: new HttpOrigin("origin.example.com") },
        });
        new CfnOutput(stack, "DistributionId", {
          value: distribution.distributionId,
        });
        const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
          distributionId: distribution.distributionId,
          logBucket: logs.bucket,
        });
        new LogTable(stack, "RainlyticsTable", { deliveries: [delivery] });
        new QueryWorkgroup(stack, "RainlyticsQueries", {
          resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
          ...(options.cutoff === undefined
            ? {}
            : { bytesScannedCutoff: options.cutoff }),
        });
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();

    // Intercepting the class covers the client the command builds for itself,
    // which is the point: nothing about the command knows it is talking to a
    // simulation.
    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(AthenaClient);

    return {
      simAws,
      logBucketName,
      distributionId: String(
        stacks.get("AnalyticsStack")?.output("DistributionId"),
      ),
    };
  };

  type Deployed = Awaited<ReturnType<typeof deployAnalytics>>;

  /** One delivered object, written the way CloudFront writes one. */
  const putDelivered = async (
    deployed: Deployed,
    at: Date,
    records: readonly Readonly<Record<string, string>>[],
    compression = 9,
  ): Promise<void> => {
    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${partitionPrefix({
            distributionId: deployed.distributionId,
            at,
          })}/${String(at.getTime())}.gz`,
          Body: gzipSync(
            records.map((record) => JSON.stringify(record)).join("\n"),
            { level: compression },
          ),
        },
      });
  };

  /** A page view of one path, as CloudFront would have logged it. */
  const aPageView = (path: string): Readonly<Record<string, string>> => ({
    "timestamp(ms)": "1787793822795",
    "cs-uri-stem": path,
    "cs-method": "GET",
    "sc-status": "200",
    "c-country": "GB",
  });

  /** Runs the CLI the way the executable does, and reads both streams. */
  const cli = async (
    argv: readonly string[],
    outIsTerminal = false,
  ): Promise<Run> => {
    let out = "";
    let error = "";
    const code = await runCli({
      argv,
      commands: rainlyticsCommands,
      io: {
        out: (text) => {
          out += text;
        },
        error: (text) => {
          error += text;
        },
        outIsTerminal,
      },
    });

    return { code, out, error };
  };

  const twoPageViews = async (deployed: Deployed): Promise<void> => {
    await putDelivered(deployed, simStartedAt, [
      aPageView("/"),
      aPageView("/liju/"),
      aPageView("/"),
    ]);
  };

  /**
   * The `WHERE` clause naming the partition an instant sits in.
   *
   * Built from the same rendering that decided the object's key, so a test
   * moving `simStartedAt` moves the predicate with it. Written out, the two
   * would have to be kept in step by whoever noticed.
   */
  const inThePartitionOf = (at: Date): string =>
    partitionPrefix({ distributionId: "unused", at })
      .split("/")
      .slice(1)
      .map((segment) => {
        const [key = "", value = ""] = segment.split("=");

        return `${key} = '${value}'`;
      })
      .join(" AND ");

  const anHourQuery =
    "SELECT cs_uri_stem, count(*) AS views FROM cloudfront_logs" +
    ` WHERE ${inThePartitionOf(simStartedAt)}` +
    " GROUP BY 1 ORDER BY 2 DESC";

  it("answers a question about the delivered logs", async () => {
    // Given three page views delivered into the log bucket.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);

    // When somebody asks which paths were viewed.
    const run = await cli(["query", anHourQuery, "--output", "json"]);

    // Then the rows come back, grouped and counted by Athena rather than by
    // anything here.
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out)).toStrictEqual([
      { cs_uri_stem: "/", views: "2" },
      { cs_uri_stem: "/liju/", views: "1" },
    ]);
  });

  it("writes the rows in whichever format was asked for", async () => {
    // Given the same delivered logs.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);

    // When the same question is asked three ways.
    const asked =
      `SELECT cs_uri_stem FROM cloudfront_logs` +
      ` WHERE ${inThePartitionOf(simStartedAt)} AND cs_uri_stem = '/liju/'`;
    const json = await cli(["query", asked, "-o", "json"]);
    const csv = await cli(["query", asked, "-o", "csv"]);
    const table = await cli(["query", asked, "-o", "table"]);

    // Then each format carries the same answer in its own shape.
    expect(JSON.parse(json.out)).toStrictEqual([{ cs_uri_stem: "/liju/" }]);
    expect(csv.out).toBe("cs_uri_stem\n/liju/\n");
    expect(table.out).toContain("cs_uri_stem");
    expect(table.out).toContain("/liju/");
  });

  it("keeps the rows on stdout and everything else on stderr", async () => {
    // Given delivered logs.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);

    // When a query is run with output piped, which is what a shell does.
    const run = await cli(["query", anHourQuery]);

    // Then standard output is the data and nothing else, so `| jq` works as
    // typed. JSON is the default when standard output is not a terminal.
    expect(() => JSON.parse(run.out) as unknown).not.toThrow();

    // And what the query cost went to standard error, where a pipeline never
    // sees it.
    expect(run.error).toMatch(/Scanned \d+ B/u);
    expect(run.error).toContain("About $");
  });

  it("says what the query scanned and what it came to", async () => {
    // Given delivered logs.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);

    // When a query runs.
    const run = await cli(["query", anHourQuery]);

    // Then the price of the question is in front of whoever just asked it.
    // Athena bills a ten million byte minimum whatever a query reads, so a
    // small query costs the same as a ten megabyte one and the report says
    // so rather than quoting a figure that looks free.
    expect(run.error).toContain("billed as 10.0 MB (the per-query minimum)");
    expect(run.error).toContain("About $0.000050");

    // And the execution id, which is what finds the query in the console.
    expect(run.error).toMatch(/Query \S+ ran in workgroup rainlytics\./u);
  });

  it("scans less when the query names a partition", async () => {
    // Given two hours of delivered logs.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);
    const nextHour = new Date(simStartedAt.getTime() + 3_600_000);
    await putDelivered(deployed, nextHour, [aPageView("/elsewhere/")]);

    // When the same question is asked with and without an hour.
    const everything = await cli([
      "query",
      "SELECT count(*) FROM cloudfront_logs",
    ]);
    const oneHour = await cli(["query", anHourQuery]);

    // Then the qualified query reads less. This is the difference the whole
    // partition layout exists to make, and it is what a person asking an
    // ad-hoc question needs to see.
    expect(scannedBytes(oneHour.error)).toBeLessThan(
      scannedBytes(everything.error),
    );
  });

  it("stops a query that would scan past the workgroup's cutoff", async () => {
    // Given a workgroup whose cutoff is the lowest Athena accepts, and an
    // hour of logs larger than it.
    const deployed = await deployAnalytics({ cutoff: Size.bytes(10_000_000) });
    // Stored rather than compressed, since the cutoff is about the bytes the
    // object holds and gzip would take a repeated character to nothing.
    await putDelivered(
      deployed,
      simStartedAt,
      [{ ...aPageView("/"), "cs-uri-query": "q=".repeat(5_500_000) }],
      0,
    );

    // When a query reads the lot.
    const run = await cli(["query", "SELECT * FROM cloudfront_logs"]);

    // Then it fails, naming what it read and what the workgroup allows.
    expect(run.code).toBe(1);
    expect(run.error).toContain("Bytes scanned limit was exceeded");
    expect(run.error).toContain("10000000");

    // And it says what to do about it, since the limit is one somebody chose
    // and can move rather than a wall.
    expect(run.error).toContain("Narrow the query");
    expect(run.error).toContain("bytesScannedCutoff");
  });

  it("answers with no rows where the question has none", async () => {
    // Given delivered logs, and a question about a day the projection covers
    // and nothing was delivered for. A day outside the projected range would
    // answer nothing for a different reason.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);
    const aQuietDay = new Date(simStartedAt.getTime() - 86_400_000);

    // When it is asked.
    const run = await cli([
      "query",
      `SELECT cs_uri_stem FROM cloudfront_logs` +
        ` WHERE ${inThePartitionOf(aQuietDay)}`,
      "-o",
      "csv",
    ]);

    // Then the answer is an empty one rather than a failure, and the CSV
    // still carries its header. A row count of zero is a real answer.
    expect(run.code).toBe(0);
    expect(run.out).toBe("cs_uri_stem\n");
  });

  it("follows every page of a result larger than one", async () => {
    // Given more rows than Athena carries in one page, which it caps at a
    // thousand.
    const deployed = await deployAnalytics();
    await putDelivered(
      deployed,
      simStartedAt,
      Array.from({ length: 1200 }, (_unused, index) =>
        aPageView(`/page-${String(index)}/`),
      ),
    );

    // When a query asks for all of them.
    const run = await cli(["query", `SELECT cs_uri_stem FROM cloudfront_logs`]);

    // Then every page is followed. A result truncated to its first page
    // answers a different question from the one that was asked, and says
    // nothing about having done so.
    expect(JSON.parse(run.out) as unknown[]).toHaveLength(1200);
  });

  it("reports a query Athena would not run", async () => {
    // Given a query naming a table nobody created.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);

    // When it is run.
    const run = await cli(["query", "SELECT * FROM no_such_table"]);

    // Then Athena's own reason comes back, without anything added. The
    // cutoff is the one failure worth explaining, and dressing up the rest
    // would put this command between a person and what Athena told them.
    expect(run.code).toBe(1);
    expect(run.error).toContain("no_such_table");
    expect(run.error).not.toContain("Narrow the query");

    // And no charge is quoted for it. Athena does not bill a failed query,
    // so pricing one would be inventing a cost.
    expect(run.error).toContain("does not charge for a query that failed");
    expect(run.error).not.toContain("About $");
  });

  it("names the actions a query takes, where the caller has none", async () => {
    // Given an identity allowed to read Athena and to run nothing, which is
    // what an SSO read-only role carries.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);
    const reader = await readingAthenaCaller(deployed.simAws);

    // When it asks a question.
    const run = await deployed.simAws.runAs(reader, async () =>
      cli(["query", anHourQuery]),
    );

    // Then the four actions running a query takes are named, against the
    // workgroup and the results bucket they apply to. Whoever meets this has
    // a policy to write and nothing else to go on.
    expect(run.code).toBe(1);
    expect(run.error).toContain(
      "Running a query takes athena:StartQueryExecution and" +
        " athena:StopQueryExecution on the rainlytics workgroup, and" +
        " s3:PutObject and s3:AbortMultipartUpload on the bucket that" +
        " workgroup writes results to.",
    );

    // And the summaries are offered, since reading one takes a GET and this
    // identity has every read there is. A refusal that stopped at the policy
    // would leave an answer on the table.
    expect(run.error).toContain("summary on s3:GetObject alone");
    expect(run.error).toContain(
      `--summaries, or put it in ${summaryBucketVariable}`,
    );

    // And the region is left out of it. This query went where it meant to,
    // and asking somewhere else changes nothing.
    expect(run.error).not.toContain("Name another with --region");
  });

  it("refuses SQL the shell took apart", async () => {
    // Given a query typed without quotes, which a shell splits on spaces.
    const run = await cli(["query", "SELECT", "1", "FROM", "cloudfront_logs"]);

    // Then it says so rather than running the first word. Athena would take
    // "SELECT" as a whole statement and fail somewhere less obvious.
    expect(run.code).toBe(2);
    expect(run.error).toContain("query takes one argument and got 4");
    expect(run.error).toContain('Run "rainlytics query --help"');
  });

  it("refuses to run with no SQL at all", async () => {
    // Given the command on its own.
    const run = await cli(["query"]);

    // Then it asks for the statement.
    expect(run.code).toBe(2);
    expect(run.error).toContain("query takes the SQL to run");
  });

  it("asks Athena in the region it was told to", async () => {
    // Given a deployment in us-east-1, which is where the workgroup and the
    // table were created.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);

    // When the same question is asked somewhere else.
    const run = await cli(["query", anHourQuery, "--region", "eu-west-1"]);

    // Then it is asked there rather than where the data is, and finds no
    // workgroup. A region the client never received would have answered this
    // question from us-east-1 and succeeded.
    expect(run.code).toBe(1);
    expect(run.error).toContain("WorkGroup rainlytics is not found");

    // And the message says where it looked, which Athena's own never does.
    // "Not found" about something sitting in the region you meant is the
    // failure this names.
    expect(run.error).toContain("Athena was asked in eu-west-1");
  });

  it("answers from the region the log bucket is in", async () => {
    // Given the same deployment, and the region it went to.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);

    // When the query names that region.
    const run = await cli([
      "query",
      anHourQuery,
      "--region",
      "us-east-1",
      "-o",
      "json",
    ]);

    // Then the rows come back.
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out)).toStrictEqual([
      { cs_uri_stem: "/", views: "2" },
      { cs_uri_stem: "/liju/", views: "1" },
    ]);

    // And the report says where it ran. A question answering zero rows can
    // then be checked against where the data is.
    expect(run.error).toMatch(
      /Query \S+ ran in workgroup rainlytics in us-east-1\./u,
    );
  });

  it("runs in the workgroup it is told to", async () => {
    // Given a deployment whose workgroup was left at its default.
    const deployed = await deployAnalytics();
    await twoPageViews(deployed);

    // When a query names a workgroup that was never created.
    const run = await cli([
      "query",
      anHourQuery,
      "--workgroup",
      "not-a-workgroup",
    ]);

    // Then Athena refuses it there rather than quietly running it somewhere
    // with no cutoff. A query in the wrong workgroup is a query with no
    // ceiling on it.
    expect(run.code).toBe(1);
    expect(run.error).toContain("not-a-workgroup");
  });

  /**
   * The bytes a scan report names, whichever unit it wrote them in.
   *
   * The unit has to come back with the figure. Comparing "8.12 MB" against
   * "265 KB" on the digits alone says the second is larger, which would let
   * a broken projection pass this file's pruning case.
   */
  const scannedBytes = (report: string): number => {
    const scale: Readonly<Record<string, number>> = {
      B: 1,
      KB: 1e3,
      MB: 1e6,
      GB: 1e9,
      TB: 1e12,
    };
    const [, digits = "0", unit = "B"] =
      /Scanned ([\d.]+) ([KMGT]?B)/u.exec(report) ?? [];

    return Number(digits) * (scale[unit] ?? 1);
  };
});
