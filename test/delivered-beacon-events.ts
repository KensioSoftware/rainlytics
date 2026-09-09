/**
 * A deployed table with beacon events in it, for the questions over them.
 *
 * `beacon-rollup.test.ts` and `beacon-totals-rollup.test.ts` both need one
 * hour of delivered rows and a query engine that will actually run SQL over
 * them. The deployment is the same three constructs both times, and the
 * encoding a record carries is the pass a rollup reads back off, so a copy in
 * each file would be two statements of one rule.
 *
 * `log-table.test.ts` deploys the same constructs for questions about the
 * table itself and takes options these have no use for.
 */

import { gzipSync } from "node:zlib";

import type { SimAws } from "@kensio/yulin";
import { faker } from "@faker-js/faker";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { type App, CfnOutput, Stack } from "aws-cdk-lib/core";

import {
  type BeaconEvent,
  beaconQueryString,
  defaultBeaconPath,
} from "../src/beacon-events.js";
import { CloudFrontLogDelivery } from "../src/cdk/log-delivery.js";
import { LogBucket } from "../src/cdk/log-bucket.js";
import { LogTable } from "../src/cdk/log-table.js";

import { deployStacks } from "./simulated-deployment.js";

/** The hour every case seeds into, unless it says otherwise. */
export const theBeaconHour = new Date("2026-08-23T09:00:00.000Z");

/** The day that hour falls in, which is what a case counts over. */
export const theBeaconDay = {
  from: new Date("2026-08-23T00:00:00.000Z"),
  to: new Date("2026-08-24T00:00:00.000Z"),
};

/** One request, as the beacon sends it and CloudFront records it. */
export interface SentEvent extends BeaconEvent {
  /** Who sent it, which is what the flood cap is keyed on. */
  readonly address: string;

  /** When, which decides the hour the cap applies over. */
  readonly at?: Date | undefined;

  /** What the sender called itself, defaulting to a browser. */
  readonly userAgent?: string | undefined;
}

/** A deployed table, and what a case needs to reach it afterwards. */
export interface DeployedBeaconTable {
  /** The simulated account, for seeding rows and running queries. */
  readonly simAws: SimAws;

  /** The bucket the delivery writes into. */
  readonly logBucketName: string;

  /** Where Athena writes what a query answered. */
  readonly resultsBucketName: string;

  /** The distribution the rows are partitioned under. */
  readonly distributionId: string;
}

/**
 * A log bucket, a delivery and a table over it, in a simulated account.
 *
 * Small on purpose. Everything here is one deployment of one table with the
 * query engine on, which is what a rollup's SQL needs to be run rather than
 * read.
 */
export async function deployBeaconTable(): Promise<DeployedBeaconTable> {
  const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
  const resultsBucketName = `rainlytics-results-${faker.string.uuid()}`;

  const { simAws, stacks } = await deployStacks((app: App, account: string) => {
    const stack = new Stack(app, "AnalyticsStack", {
      env: { account, region: "us-east-1" },
    });

    const logs = new LogBucket(stack, "RainlyticsLogs", {
      bucketName: logBucketName,
    });
    new Bucket(stack, "QueryResults", { bucketName: resultsBucketName });

    // Deployed rather than invented, for the reason log-delivery.test.ts
    // deploys one. AWS refuses a delivery source naming a distribution that
    // is not there.
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
  });

  await simAws.region("us-east-1").account().athena().engine().enable();

  return {
    simAws,
    logBucketName,
    resultsBucketName,
    distributionId: String(
      stacks.get("AnalyticsStack")?.output("DistributionId"),
    ),
  };
}

/**
 * A query string as CloudFront writes it into a record.
 *
 * The browser encoded it once and CloudFront encodes what it writes again,
 * which is the pass `beaconEventColumn` reads back off.
 *
 * Exported for a case building its own records. `conversion-rollup.test.ts`
 * seeds page requests beside beacon rows, so it cannot go through
 * {@link putDeliveredEvents}, and a second copy of this would be a second
 * statement of what CloudFront does to a query string.
 */
export function asCloudFrontWrites(queryString: string): string {
  return queryString
    .split("&")
    .map((pair) => {
      const [name = "", value = ""] = pair.split("=");

      return `${name}=${encodeURIComponent(value)}`;
    })
    .join("&");
}

/**
 * These events, delivered into the bucket the way CloudFront delivers them.
 *
 * Every record lands in the partition for the hour in {@link theBeaconHour},
 * whatever timestamp it carries. The partition is what a query prunes on and
 * the timestamp is what the cap groups by, and a case moving one event into
 * the next hour is asking about the second of those.
 */
export async function putDeliveredEvents(
  deployed: DeployedBeaconTable,
  sent: readonly SentEvent[],
): Promise<void> {
  await putDeliveredRecords(
    deployed,
    sent.map((event) => ({
      "timestamp(ms)": String((event.at ?? theBeaconHour).getTime()),
      "cs-method": "GET",
      "cs-uri-stem": defaultBeaconPath,
      "cs-uri-query": asCloudFrontWrites(beaconQueryString(event)),
      "cs(User-Agent)": event.userAgent ?? "Mozilla/5.0",
      "c-ip": event.address,
    })),
  );
}

/**
 * Whatever records a case wrote, delivered into the hour's partition.
 *
 * The half of {@link putDeliveredEvents} that has nothing to do with beacon
 * events. A question reading page requests and beacon rows together builds
 * both kinds itself and hands them over here.
 */
export async function putDeliveredRecords(
  deployed: DeployedBeaconTable,
  records: readonly Readonly<Record<string, string>>[],
): Promise<void> {
  await deployed.simAws
    .region("us-east-1")
    .account()
    .s3()
    .putObject({
      input: {
        Bucket: deployed.logBucketName,
        Key:
          `rainlytics/distributionid=${deployed.distributionId}` +
          `/year=2026/month=08/day=23/hour=09/events.gz`,
        Body: gzipSync(
          records.map((record) => JSON.stringify(record)).join("\n"),
        ),
      },
    });
}
