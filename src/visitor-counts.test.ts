import {
  assertArrayLength,
  assertFalse,
  assertIdentical,
  assertSetSize,
  assertStringIncludes,
} from "@kensio/smartass";
import { gzipSync } from "node:zlib";

import { AthenaClient } from "@aws-sdk/client-athena";
import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { type App, CfnOutput, Stack } from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { runAthenaQuery } from "./athena/athena-query.js";
import { CloudFrontLogDelivery } from "./cdk/log-delivery.js";
import { LogBucket } from "./cdk/log-bucket.js";
import { LogTable } from "./cdk/log-table.js";
import { QueryWorkgroup } from "./cdk/query-workgroup.js";
import { partitionPrefix } from "./partitions.js";
import { qualifiedTableName } from "./dataset.js";
import {
  rollupRequest,
  summarisedWindow,
  windowPlaceholder,
} from "./rollups.js";
import { windowedSql } from "./summary-runs.js";
import type { SummaryWindow } from "./summary-windows.js";
import {
  visitorColumn,
  visitorCountSql,
  visitorRows,
} from "./visitor-counts.js";
import {
  saltedSql,
  visitorSaltPlaceholder,
  visitorIdentifier,
} from "./visitor-identity.js";

describe("the query that counts visitors", () => {
  it("says which window and which day's salt it is for", () => {
    // Given the SQL a schedule is deployed with.
    const sql = visitorCountSql(rollupRequest({ range: summarisedWindow }));

    // Then it names neither yet. The window and the salt both arrive when the
    // job runs, which is what keeps the salt out of the CloudFormation
    // template and out of a schedule's target input.
    assertStringIncludes(sql, windowPlaceholder);
    assertStringIncludes(sql, visitorSaltPlaceholder);
    assertStringIncludes(sql, `AS ${visitorColumn}`);
  });

  it("counts over the pages a request was narrowed to", () => {
    // Given a question narrowed to one section of one site.
    const sql = visitorCountSql(
      rollupRequest({
        range: summarisedWindow,
        host: "www.example.com",
        paths: ["/grammar/"],
      }),
    );

    // Then the count covers exactly the rows the question beside it covers.
    // A summary reporting 412 views and 317 visitors is two numbers over one
    // set of rows.
    assertStringIncludes(sql, "x_host_header = 'www.example.com'");
    assertStringIncludes(sql, "'/grammar/'");
    assertStringIncludes(sql, "sc_content_type LIKE 'text/html%'");
    assertStringIncludes(sql, "c_ip <> '-'");
  });
});

/*
 * What one record hashes to, run through Athena.
 *
 * These select the identifier itself over the rows the shipped count reads.
 * Simulated Athena computes the digest. The identifiers here are the ones a
 * deployment counts.
 */
describe("who one identifier stands for", () => {
  let intercepted: SimSdk | undefined;

  const anHour = new Date("2026-08-23T08:00:00.000Z");
  const nextDay = new Date("2026-08-24T08:00:00.000Z");

  /** A pipeline in a simulated account, with the SDK pointed at it. */
  const deployAnalytics = async () => {
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
        });
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();

    // What the previous case in this file replaced, put back before this one
    // replaces it again.
    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(AthenaClient);
    intercepted.intercept(S3Client);

    return {
      simAws,
      logBucketName,
      distributionId: String(
        stacks.get("AnalyticsStack")?.output("DistributionId"),
      ),
    };
  };

  type Deployed = Awaited<ReturnType<typeof deployAnalytics>>;

  /** One delivered pageview from one address. */
  const putView = async (
    deployed: Deployed,
    at: Date,
    address?: string,
  ): Promise<void> => {
    const record = {
      "timestamp(ms)": String(at.getTime()),
      "x-host-header": "www.example.com",
      "cs-method": "GET",
      "cs-uri-stem": "/",
      "cs-uri-query": "-",
      "sc-status": "200",
      "sc-content-type": "text/html",
      "cs(Referer)": "-",
      "cs(User-Agent)": "Mozilla/5.0%20(Macintosh)",
      "x-edge-result-type": "Hit",
      "c-country": "GB",
      ...(address === undefined ? {} : { "c-ip": address }),
    };
    const prefix = partitionPrefix({
      distributionId: deployed.distributionId,
      at,
    });

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${prefix}/${faker.string.uuid()}.gz`,
          Body: gzipSync(JSON.stringify(record)),
        },
      });
  };

  /**
   * The distinct identifiers one window holds, under one day's salt.
   *
   * The account is the one `deployAnalytics` deployed. Every case here builds
   * one before it seeds anything, and the SDK is pointed at it there.
   */
  const identifiersIn = async (
    window: SummaryWindow,
    salt: string,
  ): Promise<readonly string[]> => {
    // The rows the shipped count reads, with the identifier it counts put
    // where the count would be.
    const request = rollupRequest({ range: summarisedWindow });
    const lines = [
      `SELECT DISTINCT ${visitorIdentifier} AS visitor`,
      `  FROM ${qualifiedTableName()}`,
      visitorRows(request),
    ];
    const template = `${lines.join("\n")}\n`;
    const outcome = await runAthenaQuery({
      sql: windowedSql(saltedSql(template, salt), window),
      database: "rainlytics",
      workgroup: "rainlytics",
      region: "us-east-1",
    });

    assertIdentical(outcome.state, "SUCCEEDED");

    return outcome.rows.map((row) => String(row["visitor"]));
  };

  const anHourly = (at: Date): SummaryWindow => ({
    granularity: "hourly",
    at,
  });

  it("is one identifier for two visits from one address", async () => {
    // Given one address looking at two pages within the hour.
    const deployed = await deployAnalytics();
    await putView(deployed, anHour, "203.0.113.7");
    await putView(deployed, anHour, "203.0.113.7");

    // Then the hour holds one visitor.
    assertArrayLength(await identifiersIn(anHourly(anHour), "a-salt"), 1);
  });

  it("is two identifiers for two addresses on one day", async () => {
    // Given two addresses looking at the site in the same hour, counted
    // under the one salt that day has.
    const deployed = await deployAnalytics();
    await putView(deployed, anHour, "203.0.113.7");
    await putView(deployed, anHour, "198.51.100.24");

    // Then the hour holds two visitors.
    const identifiers = await identifiersIn(anHourly(anHour), "a-salt");

    assertSetSize(new Set(identifiers), 2);
  });

  it("is two identifiers for one address on two days", async () => {
    // Given one address looking at the site today and again tomorrow. The
    // two days have two salts, which `visitor-salt.ts` derives.
    const deployed = await deployAnalytics();
    await putView(deployed, anHour, "203.0.113.7");
    await putView(deployed, nextDay, "203.0.113.7");

    // When each day is counted under its own salt.
    const [today, tomorrow] = await Promise.all([
      identifiersIn(anHourly(anHour), "todays-salt"),
      identifiersIn(anHourly(nextDay), "tomorrows-salt"),
    ]);

    // Then the same person is a different visitor. This is why a month is not
    // the sum of its days, and why `VisitorCount` says `additive: false`.
    assertArrayLength(today, 1);
    assertArrayLength(tomorrow, 1);
    assertFalse(Object.is(today[0], tomorrow[0]));
  });

  it("hashes nothing for a record delivered without an address", async () => {
    // Given an hour holding one record from before `c-ip` was delivered
    // alongside one from after it.
    const deployed = await deployAnalytics();
    await putView(deployed, anHour, "203.0.113.7");
    await putView(deployed, anHour);

    // When the hour is counted.
    const identifiers = await identifiersIn(anHourly(anHour), "a-salt");

    // Then only the record with an address is counted. The addressless one
    // hashes to an identifier of its own, and leaving it in would show up
    // here as a second visitor. Every record of the days before the delivery
    // changed would gather into that one and report somebody nobody was.
    assertArrayLength(identifiers, 1);
  });
});
