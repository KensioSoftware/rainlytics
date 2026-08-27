import { CfnWorkGroup } from "aws-cdk-lib/aws-athena";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import type { Duration, RemovalPolicy, Size } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import { defaultWorkgroupName } from "../dataset.js";
import { assertUsableCutoff, defaultBytesScannedCutoff } from "./query-cost.js";
import { queryResultsBucket } from "./query-results-bucket.js";

/** What a Rainlytics query workgroup can be told. */
export interface QueryWorkgroupProps {
  /**
   * The workgroup's name, which whatever runs a query has to name too.
   *
   * @default {@link defaultWorkgroupName}
   */
  readonly workgroupName?: string | undefined;

  /**
   * The most one query may scan before Athena refuses it.
   *
   * @default {@link defaultBytesScannedCutoff}
   */
  readonly bytesScannedCutoff?: Size | undefined;

  /**
   * How long a query's results are kept before S3 expires them.
   *
   * @default a week, being `defaultResultsRetention`
   */
  readonly resultsRetention?: Duration | undefined;

  /**
   * A name for the results bucket. Left out, CloudFormation names it.
   */
  readonly resultsBucketName?: string | undefined;

  /**
   * The prefix inside that bucket which results are written under.
   *
   * @default "queries"
   */
  readonly resultsPrefix?: string | undefined;

  /**
   * Whether destroying the results bucket empties it first.
   *
   * Only meaningful alongside `RemovalPolicy.DESTROY`, and CDK refuses the
   * combination with any other policy.
   *
   * @default false
   */
  readonly autoDeleteObjects?: boolean | undefined;

  /**
   * What happens to the results bucket when the stack goes.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy | undefined;
}

/**
 * An Athena workgroup that bounds what one query can cost, and the bucket its
 * results are written to.
 *
 * ```typescript
 * const queries = new QueryWorkgroup(this, "RainlyticsQueries");
 * ```
 *
 * Every query naming this workgroup runs under its cutoff and writes where it
 * says. The result configuration is enforced, so a client asking for its own
 * output location gets this one anyway.
 *
 * A guardrail is worth having before there is anything to guard. Athena bills
 * per byte scanned and reports nothing at the time, so an unpartitioned query
 * against a growing dataset is the one failure in this pipeline that costs
 * money quietly. `docs/query-workgroup/` has the arithmetic behind the
 * default.
 */
export class QueryWorkgroup extends Construct {
  /** The workgroup itself. */
  readonly workgroup: CfnWorkGroup;

  /** Where query results are written. */
  readonly resultsBucket: Bucket;

  /** What a query has to name to run under the cutoff. */
  readonly workgroupName: string;

  /** The S3 location results land in. */
  readonly resultsLocation: string;

  constructor(scope: Construct, id: string, props: QueryWorkgroupProps = {}) {
    super(scope, id);

    const cutoff = props.bytesScannedCutoff ?? defaultBytesScannedCutoff;
    assertUsableCutoff(cutoff);

    this.workgroupName = props.workgroupName ?? defaultWorkgroupName;
    this.resultsBucket = queryResultsBucket(this, props);
    this.resultsLocation = `s3://${this.resultsBucket.bucketName}/${
      props.resultsPrefix ?? "queries"
    }/`;

    this.workgroup = new CfnWorkGroup(this, "WorkGroup", {
      name: this.workgroupName,
      description:
        "Rainlytics analytics queries, with a per-query bytes-scanned cutoff.",
      state: "ENABLED",
      /*
       * A workgroup holding named queries refuses to be deleted without
       * this, and the rollups in M3 register named queries against it. The
       * queries are rebuilt by the next deploy, so taking them with the
       * workgroup loses nothing.
       */
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        bytesScannedCutoffPerQuery: cutoff.toBytes(),
        /*
         * Covers the result configuration and nothing else. The cutoff above
         * binds either way, since it is a workgroup property and
         * `StartQueryExecution` has no parameter a caller could raise it
         * with. What this stops is a query writing its results outside the
         * expiry, the encryption and the blocked public access the results
         * bucket carries.
         */
        enforceWorkGroupConfiguration: true,
        /*
         * Off, and this is a cost decision rather than an oversight.
         * CloudWatch bills a workgroup's query metrics as custom metrics, at
         * $0.30 per metric per month for the first 10,000 (read from the AWS
         * Pricing API on 2026-08-27). That is charged for the metric
         * existing, so it does not fall to zero on a site nobody queries.
         * A pipeline whose whole premise is usage-priced infrastructure
         * should not carry a standing monthly charge to count its own
         * queries. `GetQueryExecution` reports what one query scanned, for
         * nothing.
         */
        publishCloudWatchMetricsEnabled: false,
        resultConfiguration: {
          outputLocation: this.resultsLocation,
          // S3-managed keys, which cost nothing per request. The bucket
          // encrypts what lands in it anyway, and saying so here means the
          // workgroup asks for it rather than relying on the bucket.
          encryptionConfiguration: { encryptionOption: "SSE_S3" },
        },
      },
    });
  }
}
