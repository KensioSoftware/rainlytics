import { gzipSync } from "node:zlib";

import { AthenaClient } from "@aws-sdk/client-athena";
import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { type App, CfnOutput, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

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
  visitorText,
} from "./visitor-identity.js";

describe("the query that counts visitors", () => {
  it("says which window and which day's salt it is for", () => {
    // Given the SQL a schedule is deployed with.
    const sql = visitorCountSql(rollupRequest({ range: summarisedWindow }));

    // Then it names neither yet. The window and the salt both arrive when the
    // job runs, which is what keeps the salt out of the CloudFormation
    // template and out of a schedule's target input.
    expect(sql).toContain(windowPlaceholder);
    expect(sql).toContain(visitorSaltPlaceholder);
    expect(sql).toContain(`AS ${visitorColumn}`);
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
    expect(sql).toContain("x_host_header = 'www.example.com'");
    expect(sql).toContain("'/grammar/'");
    expect(sql).toContain("sc_content_type LIKE 'text/html%'");
    expect(sql).toContain("c_ip <> '-'");
  });
});

/*
 * What one record hashes to, run through Athena.
 *
 * These count the distinct text a digest is taken over rather than the digest
 * itself. Yulin's Athena engine has no `sha256`, `to_utf8` or `to_hex`, and a
 * query reaching for one comes back empty under a SUCCEEDED state.
 * KensioSoftware/yulin#1082 is that gap.
 *
 * `sha256` is injective for these purposes, so two texts are two identifiers
 * and one text is one. What the cases below establish about the text
 * therefore holds of the identifier over it.
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
   * The distinct texts one window hashes, under one day's salt.
   *
   * The account is the one `deployAnalytics` deployed. Every case here builds
   * one before it seeds anything, and the SDK is pointed at it there.
   */
  const textsIn = async (
    window: SummaryWindow,
    salt: string,
  ): Promise<readonly string[]> => {
    // The rows the shipped count reads, with the text a digest is taken over
    // put where the count would be. Yulin cannot evaluate the digest, and it
    // runs everything under it.
    const request = rollupRequest({ range: summarisedWindow });
    const lines = [
      `SELECT DISTINCT ${visitorText} AS visitor`,
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

    expect(outcome.state).toBe("SUCCEEDED");

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
    await expect(textsIn(anHourly(anHour), "a-salt")).resolves.toHaveLength(1);
  });

  it("is two identifiers for two addresses on one day", async () => {
    // Given two addresses looking at the site in the same hour, counted
    // under the one salt that day has.
    const deployed = await deployAnalytics();
    await putView(deployed, anHour, "203.0.113.7");
    await putView(deployed, anHour, "198.51.100.24");

    // Then the hour holds two visitors.
    const texts = await textsIn(anHourly(anHour), "a-salt");

    expect(new Set(texts).size).toBe(2);
  });

  it("is two identifiers for one address on two days", async () => {
    // Given one address looking at the site today and again tomorrow. The
    // two days have two salts, which `visitor-salt.ts` derives.
    const deployed = await deployAnalytics();
    await putView(deployed, anHour, "203.0.113.7");
    await putView(deployed, nextDay, "203.0.113.7");

    // When each day is counted under its own salt.
    const [today, tomorrow] = await Promise.all([
      textsIn(anHourly(anHour), "todays-salt"),
      textsIn(anHourly(nextDay), "tomorrows-salt"),
    ]);

    // Then the same person is a different visitor. This is why a month is not
    // the sum of its days, and why `VisitorCount` says `additive: false`.
    expect(today).toHaveLength(1);
    expect(tomorrow).toHaveLength(1);
    expect(today[0]).not.toBe(tomorrow[0]);
  });

  it("hashes nothing for a record delivered without an address", async () => {
    // Given an hour holding one record from before `c-ip` was delivered
    // alongside one from after it.
    const deployed = await deployAnalytics();
    await putView(deployed, anHour, "203.0.113.7");
    await putView(deployed, anHour);

    // When the hour is counted.
    const texts = await textsIn(anHourly(anHour), "a-salt");

    // Then only the record with an address is counted. Left in, every record
    // of the days before the delivery changed would gather into one
    // identifier and report a visitor nobody was.
    expect(texts).toStrictEqual([
      "a-salt|203.0.113.7|Mozilla/5.0%20(Macintosh)",
    ]);
  });
});
