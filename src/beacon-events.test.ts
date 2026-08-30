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
import {
  type BeaconEvent,
  beaconParameters,
  beaconQueryString,
  beaconSchemaVersion,
  defaultBeaconPath,
} from "./beacon-events.js";
import {
  aBeaconEvent,
  beaconEventColumn,
  beaconMessageColumn,
  beaconValueColumn,
} from "./beacon-rows.js";
import { qualifiedTableName } from "./dataset.js";
import { partitionPredicate } from "./rollup-rows.js";
import { CloudFrontLogDelivery } from "./cdk/log-delivery.js";
import { LogBucket } from "./cdk/log-bucket.js";
import { LogTable } from "./cdk/log-table.js";
import { QueryWorkgroup } from "./cdk/query-workgroup.js";
import { partitionPrefix } from "./partitions.js";
import { rollups } from "./rollup-questions.js";
import { rollupRequest, rollupSql } from "./rollups.js";

describe("the beacon event envelope", () => {
  it("stamps every event with the version it was written under", () => {
    // Given an event the beacon is about to send.
    const sent = beaconQueryString({
      event: "route",
      page: "/guides/",
    });

    // Then the version rides with it. The raw store keeps whatever was
    // written into it, so a row has to say which shape it is rather than
    // leave a reader to infer one from the date.
    expect(sent).toContain(
      `${beaconParameters.version}=${String(beaconSchemaVersion)}`,
    );
  });

  it("carries the page the event happened on, since the path cannot", () => {
    // Given a route change on a page whose address the request never names.
    // Every beacon request goes to the same path, so the path in the log says
    // where the beacon is and never where the reader was.
    const page = `/${faker.word.noun()}/`;

    // When it is sent.
    const sent = beaconQueryString({ event: "route", page });

    // Then the page travels in the payload.
    expect(sent).toContain(
      `${beaconParameters.page}=${encodeURIComponent(page)}`,
    );
  });

  it("encodes a value that would otherwise end the query string", () => {
    // Given a page whose address holds the characters that separate one
    // parameter from the next, which a router with a catch-all route can
    // produce.
    const sent = beaconQueryString({
      event: "route",
      page: "/search/?q=a&b=c",
    });

    // Then they arrive as text rather than as three more parameters. Read
    // back, the page is the address the reader was on.
    expect(sent).toContain("%3Fq%3Da%26b%3Dc");
    expect(sent.split("&")).toHaveLength(3);
  });

  it("sends to a path a site is unlikely to serve already", () => {
    // Given the default path.
    // Then it is one path, absolute, and marked as not a page. Pointing the
    // beacon at a published page would count every event as a view of it and
    // download that page a second time.
    expect(defaultBeaconPath).toMatch(/^\/_/u);
  });
});

/*
 * What each shipped question does with a window holding beacon events.
 *
 * Run against delivered records rather than read off the SQL. Four of the
 * five leave beacon rows out through conditions they had for their own
 * reasons, and a case asserting the condition is there says nothing about
 * whether it covers a beacon row. KensioSoftware/rainlytics#103 asked which
 * of the five were exposed, and this is the answer being checked rather than
 * argued.
 */
describe("a window holding beacon events", () => {
  let intercepted: SimSdk | undefined;

  const anHour = new Date("2026-08-23T08:00:00.000Z");
  const theHour = {
    from: anHour,
    to: new Date(anHour.getTime() + 60 * 60 * 1000),
  };

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

  /**
   * One value as CloudFront writes it into a record.
   *
   * The pass this package decodes back off. A URI reaches the edge carrying
   * the browser's own encoding and CloudFront encodes the result again, so a
   * beacon payload holding `%2F` is delivered as `%252F`.
   */
  const delivered = (value: string): string => value.replaceAll("%", "%25");

  /** One delivered record, over the fields these questions read. */
  const putRecord = async (
    deployed: Deployed,
    record: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const prefix = partitionPrefix({
      distributionId: deployed.distributionId,
      at: anHour,
    });
    const delivery = {
      "timestamp(ms)": String(anHour.getTime()),
      "x-host-header": "www.example.com",
      "cs-method": "GET",
      "cs-uri-query": "-",
      "cs(Referer)": "-",
      "cs(User-Agent)": "Mozilla/5.0%20(Macintosh)",
      "c-ip": "203.0.113.7",
      "c-country": "GB",
      ...record,
    };

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${prefix}/${faker.string.uuid()}.gz`,
          Body: gzipSync(JSON.stringify(delivery)),
        },
      });
  };

  /** A page the site served, referred to by somewhere else. */
  const putPageView = (deployed: Deployed, path: string): Promise<void> =>
    putRecord(deployed, {
      "cs-uri-stem": path,
      "sc-status": "200",
      "sc-content-type": "text/html",
      "cs(Referer)": delivered("https://news.example.org/a"),
      "x-edge-result-type": "Hit",
    });

  /** The broken asset this question exists to surface. */
  const putMissingAsset = (deployed: Deployed): Promise<void> =>
    putRecord(deployed, {
      "cs-uri-stem": "/style.css",
      "sc-status": "404",
      "sc-content-type": "text/html",
      "x-edge-result-type": "Error",
    });

  /** One search, as the site's own search page answers it. */
  const putSearch = (deployed: Deployed, term: string): Promise<void> =>
    putRecord(deployed, {
      "cs-uri-stem": "/search/",
      "cs-uri-query": delivered(`q=${encodeURIComponent(term)}`),
      "sc-status": "200",
      "sc-content-type": "text/html",
      "x-edge-result-type": "Miss",
    });

  /**
   * One beacon event, as CloudFront records the request carrying it.
   *
   * A 204 from a CloudFront Function on viewer request. Nothing reaches the
   * origin, no body comes back, and the query string is logged whatever the
   * cache key is set to.
   */
  const putBeaconPayload = (
    deployed: Deployed,
    event: BeaconEvent,
  ): Promise<void> =>
    putRecord(deployed, {
      "cs-uri-stem": defaultBeaconPath,
      "cs-uri-query": delivered(beaconQueryString(event)),
      "sc-status": "204",
      "sc-content-type": "-",
      "cs(Referer)": delivered(`https://www.example.com${event.page}`),
      "x-edge-result-type": "FunctionGeneratedResponse",
    });

  /** One route change, which is what most of these cases seed. */
  const putBeaconEvent = (deployed: Deployed, page: string): Promise<void> =>
    putBeaconPayload(deployed, { event: "route", page });

  /**
   * What the beacon columns read off the rows in the hour.
   *
   * A plain select rather than a rollup, because no shipped question reads
   * these two yet. #112 left a rollup over the vitals to its own issue, and
   * this is the round trip that has to hold before one can be written.
   */
  const beaconRows = async (): Promise<
    readonly Readonly<Record<string, string | undefined>>[]
  > => {
    const outcome = await runAthenaQuery({
      sql:
        `SELECT ${beaconEventColumn} AS event,\n` +
        `    ${beaconValueColumn} AS value,\n` +
        `    ${beaconMessageColumn} AS message\n` +
        `  FROM ${qualifiedTableName()}\n` +
        `  WHERE ${partitionPredicate(theHour)}\n` +
        `    AND ${aBeaconEvent.join("\n    AND ")}\n` +
        `  ORDER BY 1\n`,
      database: "rainlytics",
      workgroup: "rainlytics",
      region: "us-east-1",
    });

    expect(outcome.state).toBe("SUCCEEDED");

    return outcome.rows;
  };

  /**
   * A window holding more beacon events than responses of the site's own.
   *
   * The shape the issue describes. A single-page app reporting route changes
   * sends several events per reader per page, and three pages of reading
   * against five events is a mild version of it.
   */
  const seedTheHour = async (deployed: Deployed): Promise<void> => {
    await Promise.all([
      putPageView(deployed, "/"),
      putMissingAsset(deployed),
      putSearch(deployed, "green tea"),
      ...["/", "/guides/", "/guides/", "/liju/", "/liju/"].map((page) =>
        putBeaconEvent(deployed, page),
      ),
    ]);
  };

  /** What one question answers over that hour. */
  const answerTo = async (
    name: string,
  ): Promise<readonly Readonly<Record<string, string | undefined>>[]> => {
    const rollup = rollups.find((each) => each.name === name);

    if (rollup === undefined) {
      throw new Error(`No rollup called ${name}.`);
    }

    const outcome = await runAthenaQuery({
      sql: rollupSql(rollup, rollupRequest({ range: theHour })),
      database: "rainlytics",
      workgroup: "rainlytics",
      region: "us-east-1",
    });

    expect(outcome.state).toBe("SUCCEEDED");

    return outcome.rows;
  };

  it("carries a web vital's number back off the row", async () => {
    // Given an hour holding a largest contentful paint the browser measured.
    const deployed = await deployAnalytics();
    await putBeaconPayload(deployed, {
      event: "lcp",
      page: "/guides/",
      value: 2400,
    });

    // When the beacon columns are read back.
    const rows = await beaconRows();

    // Then the number is the one the browser sent. It went through the
    // browser's encoding, CloudFront's own on the way into the record, and
    // both decodes on the way out.
    expect(rows).toStrictEqual([{ event: "lcp", value: "2400", message: "" }]);
  });

  it("carries what an error said back off the row", async () => {
    // Given an error message holding the characters that separate one
    // parameter from the next, which a message quoting a URL produces.
    const deployed = await deployAnalytics();
    const said = "TypeError: no handler for /a?b=c&d=e";
    await putBeaconPayload(deployed, {
      event: "error",
      page: "/liju/",
      message: said,
    });

    // When the beacon columns are read back.
    const rows = await beaconRows();

    // Then the message is the one the browser sent, rather than three more
    // parameters. This is the round trip a rollup counting errors by message
    // would be built on.
    expect(rows).toStrictEqual([{ event: "error", value: "", message: said }]);
  });

  it("leaves both columns empty for an event that measured nothing", async () => {
    // Given a route change, which carries neither.
    const deployed = await deployAnalytics();
    await putBeaconEvent(deployed, "/");

    // When the beacon columns are read back.
    const rows = await beaconRows();

    // Then both read empty rather than failing the query. A question over
    // one event name reads rows that all carry the same shape, and a
    // question over the lot still runs.
    expect(rows).toStrictEqual([{ event: "route", value: "", message: "" }]);
  });

  it("counts the site's own responses under status-codes", async () => {
    // Given an hour holding five beacon events and three responses the site
    // itself gave.
    const deployed = await deployAnalytics();
    await seedTheHour(deployed);

    // When the status codes are counted.
    const rows = await answerTo("status-codes");

    // Then the 404 the question exists to surface is there, and the 204 the
    // beacon answers every event with is not. Five 204s would lead this
    // table and say nothing about how the site is answering.
    expect(rows.map((row) => row["status"])).toStrictEqual(["200", "404"]);
    expect(rows.find((row) => row["status"] === "200")?.["responses"]).toBe(
      "2",
    );
  });

  it("counts no beacon event as a pageview", async () => {
    // Given the same hour.
    const deployed = await deployAnalytics();
    await seedTheHour(deployed);

    // When the pages are counted.
    const rows = await answerTo("pageviews");

    // Then the beacon's path is not among them. A beacon event answers 204
    // with no content type, and a pageview is a GET that answered HTML and
    // succeeded.
    expect(rows.map((row) => row["path"])).toStrictEqual(["/", "/search/"]);
  });

  it("counts no beacon event as an arrival", async () => {
    // Given the same hour, where every beacon event carries a referrer of
    // the page it happened on.
    const deployed = await deployAnalytics();
    await seedTheHour(deployed);

    // When the referrers are counted.
    const rows = await answerTo("referrers");

    // Then only the arrival is counted. The beacon's own referrer is this
    // site, which referrers leaves out anyway, and its rows are not
    // pageviews.
    expect(rows.map((row) => row["referrer"])).toStrictEqual([
      "news.example.org",
    ]);
    expect(rows[0]?.["views"]).toBe("1");
  });

  it("counts no beacon event as a search", async () => {
    // Given the same hour, where every beacon event carries a query string.
    const deployed = await deployAnalytics();
    await seedTheHour(deployed);

    // When the searches are counted.
    const rows = await answerTo("searches");

    // Then only what somebody typed is counted. A beacon payload names its
    // parameters `v`, `e` and `p`, and carries no `q` to read.
    expect(rows.map((row) => row["term"])).toStrictEqual(["green tea"]);
  });

  it("leaves beacon events out of the cache hit ratio", async () => {
    // Given the same hour.
    const deployed = await deployAnalytics();
    await seedTheHour(deployed);

    // When the cache is counted.
    const rows = await answerTo("cache-hit-ratio");

    // Then the denominator is the two requests whose result type says the
    // cache served or missed them. A CloudFront Function answered every
    // beacon event, and none of those reached the cache at all.
    expect(rows[0]?.["hits"]).toBe("1");
    expect(rows[0]?.["misses"]).toBe("1");
    expect(Number(rows[0]?.["hit_percent"])).toBe(50);
  });
});
