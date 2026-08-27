import { faker } from "@faker-js/faker";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { App, CfnOutput, Duration, Size, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks, simStartedAt } from "#test/simulated-deployment.js";

import {
  defaultLogDataset,
  defaultWorkgroupName,
  qualifiedTableName,
} from "../dataset.js";
import { partitionPrefix } from "../partitions.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable } from "./log-table.js";
import { defaultBytesScannedCutoff } from "./query-cost.js";
import { QueryWorkgroup, type QueryWorkgroupProps } from "./query-workgroup.js";

/**
 * The parts of an S3 lifecycle rule these cases read.
 *
 * Declared here rather than imported, for the reason log-bucket.test.ts
 * declares its own: reading a bucket back should not pull
 * `@aws-sdk/client-s3` into a package whose production code has no use for
 * it.
 */
interface LifecycleRule {
  readonly ID?: string | undefined;
  readonly Status?: string | undefined;
  readonly Expiration?: { readonly Days?: number | undefined } | undefined;
}

describe("the workgroup a Rainlytics query runs in", () => {
  /** What a deployed stack's cases reach it through. */
  interface Deployed {
    readonly simAws: Awaited<ReturnType<typeof deployStacks>>["simAws"];
    readonly logBucketName: string;
    readonly resultsBucketName: string;
    readonly distributionId: string;
  }

  /**
   * The whole readable half of the pipeline in one simulated account: a log
   * bucket, a delivery into it, a table over that and the workgroup queries
   * run in.
   *
   * All four, because the cutoff cannot be exercised against less. Athena
   * measures what a query scans from the objects the table's partitions
   * reach, so a workgroup with no table under it refuses nothing however low
   * its limit is set.
   */
  const deployWorkgroup = async (
    props: QueryWorkgroupProps = {},
  ): Promise<Deployed> => {
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
    const resultsBucketName = `rainlytics-results-${faker.string.uuid()}`;

    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "AnalyticsStack", {
          env: { account, region: "us-east-1" },
        });

        const logs = new LogBucket(stack, "RainlyticsLogs", {
          bucketName: logBucketName,
        });
        // Deployed rather than invented. A delivery source names a
        // distribution by ARN and AWS refuses one that is not there.
        const distribution = new Distribution(stack, "Site", {
          defaultBehavior: { origin: new HttpOrigin("origin.example.com") },
        });
        // The id is a token until the stack goes up, so the test reads it
        // back through an output rather than guessing what it resolved to.
        new CfnOutput(stack, "DistributionId", {
          value: distribution.distributionId,
        });
        const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
          distributionId: distribution.distributionId,
          logBucket: logs.bucket,
        });
        new LogTable(stack, "RainlyticsTable", { deliveries: [delivery] });
        new QueryWorkgroup(stack, "RainlyticsQueries", {
          ...props,
          resultsBucketName: props.resultsBucketName ?? resultsBucketName,
        });
      },
    );

    return {
      simAws,
      logBucketName,
      resultsBucketName,
      distributionId: String(
        stacks.get("AnalyticsStack")?.output("DistributionId"),
      ),
    };
  };

  /** The workgroup as simulated Athena holds it. */
  const deployedWorkgroup = ({ simAws }: Deployed, name?: string) => {
    const workgroup = simAws
      .region("us-east-1")
      .account()
      .athena()
      .findWorkGroup(name ?? defaultWorkgroupName);

    if (workgroup === undefined) {
      throw new Error("The deployment left no workgroup behind.");
    }

    return workgroup;
  };

  it("bounds what one query may scan", async () => {
    // Given the workgroup taking its default cutoff.
    // When the stack is deployed.
    const workgroup = deployedWorkgroup(await deployWorkgroup());

    // Then Athena holds the limit. Ten gibibytes caps one query at about six
    // cents, against a measured year of a busy site at 1.6GB, so a query
    // reaching it has gone wrong rather than grown into it.
    expect(workgroup.bytesScannedCutoffPerQuery).toBe(
      defaultBytesScannedCutoff.toBytes(),
    );
    expect(workgroup.state).toBe("ENABLED");
  });

  it("refuses the query that would scan past it", async () => {
    // Given a workgroup whose cutoff is the lowest Athena accepts, and an
    // hour of delivered logs that is larger than it.
    const cutoff = Size.bytes(10_000_000);
    const deployed = await deployWorkgroup({ bytesScannedCutoff: cutoff });
    await putLogObject(deployed, simStartedAt, cutoff.toBytes() + 1);

    // When a query reads that hour.
    const scan = await runQuery(deployed, `SELECT * FROM ${table()}`);

    // Then Athena stops it, and says what it scanned and what the workgroup
    // allows. This is the failure the guardrail exists to produce: an
    // unpartitioned query against a growing dataset otherwise succeeds, bills
    // for every byte, and reports nothing until the invoice.
    expect(scan.state).toBe("FAILED");
    expect(scan.reason).toMatch(/Bytes scanned limit was exceeded/u);
    expect(scan.reason).toContain(String(cutoff.toBytes()));
  });

  it("lets a query through when its predicate keeps it under", async () => {
    // Given the same workgroup and the same oversized hour, plus a small
    // object in the hour after it.
    const cutoff = Size.bytes(10_000_000);
    const deployed = await deployWorkgroup({ bytesScannedCutoff: cutoff });
    await putLogObject(deployed, simStartedAt, cutoff.toBytes() + 1);
    const nextHour = new Date(simStartedAt.getTime() + 3_600_000);
    const small = await putLogObject(deployed, nextHour, 512);

    // When a query names the hour holding the small object.
    const scan = await runQuery(
      deployed,
      `SELECT * FROM ${table()} WHERE year = '2026' AND month = '08'` +
        ` AND day = '23' AND hour = '10'`,
    );

    // Then it runs. The cutoff bounds the mistake without standing in the way
    // of the query somebody meant to run, which is what makes it safe to
    // leave on.
    expect(scan.state).toBe("SUCCEEDED");
    expect(scan.bytes).toBe(small);
  });

  it("writes results where it says, whatever the caller asks for", async () => {
    // Given a workgroup with a results location of its own.
    const deployed = await deployWorkgroup();

    // When a query asks for its results to go somewhere else.
    const scan = await runQuery(deployed, `SELECT 1`, {
      OutputLocation: `s3://${deployed.logBucketName}/somewhere-else/`,
    });

    // Then the workgroup wins. Enforcement is what makes the cutoff a
    // guardrail: a caller that can redirect the results can also raise the
    // limit, and then the workgroup is a default rather than a bound.
    // The location a described execution reports is the object holding that
    // one query's rows, under the prefix the workgroup named.
    expect(scan.outputLocation).toMatch(
      new RegExp(`^s3://${deployed.resultsBucketName}/queries/`, "u"),
    );
    expect(scan.outputLocation).not.toContain("somewhere-else");
  });

  it("expires the results it accumulates", async () => {
    // Given the workgroup taking its default retention.
    const deployed = await deployWorkgroup();

    // When S3 is asked what lifecycle rules the results bucket carries.
    const lifecycle = await deployed.simAws
      .region("us-east-1")
      .s3()
      .getBucketLifecycleConfiguration({
        input: { Bucket: deployed.resultsBucketName },
      });

    // Then results go after a week. Athena writes one object per query and
    // never reads it again, so without this the bucket grows for ever with
    // the one thing in the pipeline nobody looks at twice.
    const expiry = ruleNamed(lifecycle.Rules, "expire-query-results");
    expect(expiry.Status).toBe("Enabled");
    // Written out rather than read from `defaultResultsRetention`. Taking the
    // expected value from the thing under test would move both sides at once.
    expect(expiry.Expiration?.Days).toBe(7);
  });

  it("keeps results for as long as it is told to", async () => {
    // Given a site that wants to go back further than a week.
    const deployed = await deployWorkgroup({
      resultsRetention: Duration.days(90),
    });

    // Then that is the expiry.
    const lifecycle = await deployed.simAws
      .region("us-east-1")
      .s3()
      .getBucketLifecycleConfiguration({
        input: { Bucket: deployed.resultsBucketName },
      });
    expect(
      ruleNamed(lifecycle.Rules, "expire-query-results").Expiration?.Days,
    ).toBe(90);
  });

  it("counts its own queries without paying CloudWatch to do it", async () => {
    // Given the workgroup as deployed.
    const workgroup = deployedWorkgroup(await deployWorkgroup());

    // Then it publishes no metrics. CloudWatch bills a workgroup's query
    // metrics as custom metrics, at a flat monthly rate per metric, and that
    // charge does not fall to zero on a site nobody queries. What one query
    // scanned comes back from GetQueryExecution for nothing.
    expect(workgroup.configuration.publishCloudWatchMetricsEnabled).toBe(false);
    expect(workgroup.enforcesConfiguration).toBe(true);
  });

  it("takes a name a query can be pointed at", async () => {
    // Given a site running two Rainlytics deployments in one account.
    const deployed = await deployWorkgroup({ workgroupName: "rainlytics_dev" });

    // Then the workgroup carries that name. Whatever runs a query has to name
    // it, and a query naming no workgroup runs in `primary`, which has no
    // cutoff at all.
    expect(deployedWorkgroup(deployed, "rainlytics_dev").name).toBe(
      "rainlytics_dev",
    );
    expect(defaultWorkgroupName).toBe("rainlytics");
  });

  it("refuses a cutoff Athena would not accept", () => {
    // Given a cutoff below Athena's own minimum billing unit.
    const building = (): QueryWorkgroup => {
      const stack = new Stack(new App(), "AnalyticsStack", {
        env: { account: "123456789012", region: "us-east-1" },
      });

      return new QueryWorkgroup(stack, "RainlyticsQueries", {
        bytesScannedCutoff: Size.mebibytes(1),
      });
    };

    // Then it fails at synthesis rather than at deploy. Every query bills for
    // ten million bytes whatever it reads, so a cutoff under that refuses
    // every query, including the ones the pipeline runs on a schedule.
    expect(building).toThrow(/10000000/u);
  });

  const table = (): string => qualifiedTableName();

  /**
   * One lifecycle rule by name, or a failure naming the ones there are.
   *
   * `find` answering `undefined` would fail the assertion under it on a
   * missing `Expiration`, which reads as though the assertion is broken
   * rather than as a missing rule.
   */
  const ruleNamed = (
    rules: readonly LifecycleRule[] | undefined,
    id: string,
  ): LifecycleRule => {
    const rule = (rules ?? []).find((candidate) => candidate.ID === id);

    if (rule === undefined) {
      throw new Error(
        `No lifecycle rule "${id}". Found: ${(rules ?? [])
          .map((candidate) => candidate.ID)
          .join(", ")}`,
      );
    }

    return rule;
  };

  /**
   * One delivered object of a given size, in the partition an instant belongs
   * to. Returns its size in bytes.
   */
  const putLogObject = async (
    deployed: Deployed,
    at: Date,
    bytes: number,
  ): Promise<number> => {
    const body = Buffer.alloc(bytes, "x");
    const address = { distributionId: deployed.distributionId, at };

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${partitionPrefix(address)}/logs.gz`,
          Body: body,
        },
      });

    return bytes;
  };

  /** What one query came to, whether or not it was allowed to finish. */
  const runQuery = async (
    deployed: Deployed,
    queryString: string,
    resultConfiguration?: { readonly OutputLocation: string },
  ) => {
    const athena = deployed.simAws.region("us-east-1").account().athena();
    const started = await athena.startQueryExecution({
      input: {
        QueryString: queryString,
        WorkGroup: defaultWorkgroupName,
        QueryExecutionContext: { Database: defaultLogDataset.databaseName },
        ...(resultConfiguration === undefined
          ? {}
          : { ResultConfiguration: resultConfiguration }),
      },
    });
    await deployed.simAws.backgroundTasksComplete();

    const described = await athena.getQueryExecution({
      input: { QueryExecutionId: started.QueryExecutionId ?? "" },
    });

    return {
      state: described.QueryExecution?.Status?.State,
      reason: described.QueryExecution?.Status?.StateChangeReason ?? "",
      bytes: described.QueryExecution?.Statistics?.DataScannedInBytes,
      outputLocation:
        described.QueryExecution?.ResultConfiguration?.OutputLocation,
    };
  };
});
