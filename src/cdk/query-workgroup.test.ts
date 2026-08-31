import {
  assertArrayIncludes,
  assertFalse,
  assertIdentical,
  assertObjectEquals,
  assertStringIncludes,
  assertStringMatches,
  assertStringNotIncludes,
  assertThrowsError,
  assertTrue,
} from "@kensio/smartass";
import { gzipSync } from "node:zlib";

import { faker } from "@faker-js/faker";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { App, CfnOutput, Duration, Size, Stack } from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import { deployStacks, simStartedAt } from "#test/simulated-deployment.js";

import {
  defaultLogDataset,
  defaultWorkgroupName,
  qualifiedTableName,
} from "../dataset.js";
import { partitionPrefix } from "../partitions.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket, type LogBucketProps } from "./log-bucket.js";
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
    assertIdentical(
      workgroup.bytesScannedCutoffPerQuery,
      defaultBytesScannedCutoff.toBytes(),
    );
    assertIdentical(workgroup.state, "ENABLED");
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
    assertIdentical(scan.state, "FAILED");
    assertStringMatches(scan.reason, /Bytes scanned limit was exceeded/u);
    assertStringIncludes(scan.reason, String(cutoff.toBytes()));
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
    assertIdentical(scan.state, "SUCCEEDED");
    assertIdentical(scan.bytes, small);
  });

  it("writes results where it says, whatever the caller asks for", async () => {
    // Given a workgroup with a results location of its own.
    const deployed = await deployWorkgroup();

    // When a query asks for its results to go somewhere else.
    const scan = await runQuery(deployed, `SELECT 1`, {
      OutputLocation: `s3://${deployed.logBucketName}/somewhere-else/`,
    });

    // Then the workgroup wins. The cutoff binds either way, since no request
    // carries one. What enforcement covers is the results, which would
    // otherwise land outside the expiry and the encryption this bucket has.
    // The location a described execution reports is the object holding that
    // one query's rows, under the prefix the workgroup named.
    assertStringMatches(
      scan.outputLocation,
      new RegExp(`^s3://${deployed.resultsBucketName}/queries/`, "u"),
    );
    assertStringNotIncludes(scan.outputLocation, "somewhere-else");
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
    assertIdentical(expiry.Status, "Enabled");
    // Written out rather than read from `defaultResultsRetention`. Taking the
    // expected value from the thing under test would move both sides at once.
    assertIdentical(expiry.Expiration?.Days, 7);
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
    assertIdentical(
      ruleNamed(lifecycle.Rules, "expire-query-results").Expiration?.Days,
      90,
    );
  });

  it("counts its own queries without paying CloudWatch to do it", async () => {
    // Given the workgroup as deployed.
    const workgroup = deployedWorkgroup(await deployWorkgroup());

    // Then it publishes no metrics. CloudWatch bills a workgroup's query
    // metrics as custom metrics, at a flat monthly rate per metric, and that
    // charge does not fall to zero on a site nobody queries. What one query
    // scanned comes back from GetQueryExecution for nothing.
    assertFalse(workgroup.configuration.publishCloudWatchMetricsEnabled);
    assertTrue(workgroup.enforcesConfiguration);
  });

  it("takes a name a query can be pointed at", async () => {
    // Given a site running two Rainlytics deployments in one account.
    const deployed = await deployWorkgroup({ workgroupName: "rainlytics_dev" });

    // Then the workgroup carries that name. Whatever runs a query has to name
    // it, and a query naming no workgroup runs in `primary`, which has no
    // cutoff at all.
    assertIdentical(
      deployedWorkgroup(deployed, "rainlytics_dev").name,
      "rainlytics_dev",
    );
    assertIdentical(defaultWorkgroupName, "rainlytics");
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
    {
      const error = assertThrowsError(building);
      assertStringMatches(error.message, /10000000/u);
    }
  });

  describe("what an identity granted querying can reach", () => {
    /**
     * A whole deployment in one stack, with a role handed the grant.
     *
     * Synthesised rather than deployed. IAM is the part of this a simulated
     * account cannot prove, for the reason `summary-permissions.test.ts`
     * gives, so these cases read the policy the grant wrote.
     */
    const grantedTo = (
      logEncryption: (stack: Stack) => LogBucketProps = () => ({}),
    ): { readonly stack: Stack; readonly logBucketName: string } => {
      const stack = new Stack(new App(), "AnalyticsStack", {
        env: { account: "123456789012", region: "us-east-1" },
      });
      const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
      const logs = new LogBucket(stack, "RainlyticsLogs", {
        bucketName: logBucketName,
        ...logEncryption(stack),
      });
      const delivery = new CloudFrontLogDelivery(stack, "RainlyticsDelivery", {
        distributionId: "E1EXAMPLE1234",
        logBucket: logs.bucket,
      });
      const logTable = new LogTable(stack, "RainlyticsTable", {
        deliveries: [delivery],
      });
      const queries = new QueryWorkgroup(stack, "RainlyticsQueries", {
        resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
      });

      queries.grantQuerying(
        new Role(stack, "Analyst", {
          assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
        }),
        logTable,
      );

      return { stack, logBucketName };
    };

    /** One allow statement as CloudFormation carries it. */
    interface WrittenStatement {
      readonly Action: string | string[];
      readonly Resource: unknown;
    }

    /** The statements the granted role's own policy carries. */
    const statementsIn = (stack: Stack): readonly WrittenStatement[] => {
      const policies = Template.fromStack(stack).findResources(
        "AWS::IAM::Policy",
        {
          Properties: { Roles: [{ Ref: Match.stringLikeRegexp("^Analyst") }] },
        },
      ) as Record<
        string,
        { Properties: { PolicyDocument: { Statement: WrittenStatement[] } } }
      >;

      return Object.values(policies).flatMap(
        (policy) => policy.Properties.PolicyDocument.Statement,
      );
    };

    /** Every action those statements allow. */
    const allowed = (stack: Stack): readonly string[] =>
      statementsIn(stack).flatMap((statement) => [statement.Action].flat());

    it("reaches every service one query touches", () => {
      // Given a role a site handed the grant.
      const { stack } = grantedTo();

      // When the stack it was granted in is synthesised.
      const actions = allowed(stack);

      // Then it holds all four halves of a query. Athena starts it, Glue
      // plans it, the log bucket answers it and the results bucket takes the
      // answer, and Athena does the last three as the caller rather than as
      // itself.
      assertArrayIncludes(actions, "athena:StartQueryExecution");
      assertArrayIncludes(actions, "glue:GetPartitions");
      assertArrayIncludes(actions, "s3:GetObject");
      assertArrayIncludes(actions, "s3:PutObject");
      // And it can look up a query the site saved, which is what
      // `rainlytics saved-query` runs.
      assertArrayIncludes(actions, "athena:BatchGetNamedQuery");
    });

    it("names this deployment's resources and never a wildcard", () => {
      // Given a role granted querying over one deployment.
      const { stack } = grantedTo();

      // When the resources the grant wrote are read back.
      const resources = statementsIn(stack).map((statement) =>
        JSON.stringify(statement.Resource),
      );

      // Then it names this workgroup, this database and this table. A grant
      // reaching `*` would answer the case above and still be wrong, and the
      // account holds analytics for every site the maintainer runs.
      assertStringIncludes(resources.join(","), "workgroup/rainlytics");
      assertStringIncludes(
        resources.join(","),
        "table/rainlytics/cloudfront_logs",
      );
      assertObjectEquals(
        resources.filter((each) => each.includes('"*"')),
        [],
      );
    });

    it("decrypts a log bucket a site keeps under its own key", () => {
      // Given a deployment whose logs are encrypted with a customer key
      // rather than with S3-managed encryption.
      const { stack } = grantedTo((inStack) => ({
        encryptionKey: new Key(inStack, "LogKey"),
      }));

      // Then the grantee can decrypt what it reads. S3 answers a GetObject
      // under a key the caller cannot use with an AccessDenied from KMS, and
      // the S3 statement has nothing to say about that.
      assertArrayIncludes(allowed(stack), "kms:Decrypt");
    });
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
   * One delivered object of about a given size, in the partition an instant
   * belongs to. Returns the size it actually landed at.
   *
   * Gzipped, because the key says `.gz` and Athena reads the extension.
   * Stored rather than compressed, since a case about scanning ten million
   * bytes needs an object that holds them and gzip would take a repeated
   * character down to nothing.
   */
  const putLogObject = async (
    deployed: Deployed,
    at: Date,
    bytes: number,
  ): Promise<number> => {
    const body = gzipSync(Buffer.alloc(bytes, "x"), { level: 0 });
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

    return body.byteLength;
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
