import { gzipSync } from "node:zlib";

import { faker } from "@faker-js/faker";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { type App, CfnOutput, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import {
  beaconQueryString,
  defaultBeaconPath,
  type BeaconEvent,
} from "./beacon-events.js";
import { beaconEventCap, beaconEvents } from "./beacon-rollup.js";
import { CloudFrontLogDelivery } from "./cdk/log-delivery.js";
import { LogBucket } from "./cdk/log-bucket.js";
import { LogTable } from "./cdk/log-table.js";
import { defaultLogDataset } from "./dataset.js";
import { botUserAgentPattern, rollups } from "./index.js";
import { rollupRequest, rollupSql } from "./rollups.js";

describe("counting what the beacon reported", () => {
  const theHour = new Date("2026-08-23T09:00:00.000Z");

  /** One request, as the beacon sends it and CloudFront records it. */
  interface SentEvent extends BeaconEvent {
    /** Who sent it, which is what the flood cap is keyed on. */
    readonly address: string;

    /** When, which decides the hour the cap applies over. */
    readonly at?: Date | undefined;

    /** What the sender called itself, defaulting to a browser. */
    readonly userAgent?: string | undefined;
  }

  /**
   * A log bucket, a delivery and a table over it, in a simulated account.
   *
   * Small on purpose. Everything here is one deployment of one table with the
   * query engine on, which is what a rollup's SQL needs to be run rather than
   * read. `log-table.test.ts` deploys the same three constructs for questions
   * about the table itself and takes options this has no use for.
   */
  const deployTable = async () => {
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
        new Bucket(stack, "QueryResults", { bucketName: resultsBucketName });

        // Deployed rather than invented, for the reason log-delivery.test.ts
        // deploys one. AWS refuses a delivery source naming a distribution
        // that is not there.
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
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();

    return {
      simAws,
      logBucketName,
      resultsBucketName,
      distributionId: String(
        stacks.get("AnalyticsStack")?.output("DistributionId"),
      ),
    };
  };

  type DeployedTable = Awaited<ReturnType<typeof deployTable>>;

  /**
   * A query string as CloudFront writes it into a record.
   *
   * The browser encoded it once and CloudFront encodes what it writes again,
   * which is the pass `beaconEventColumn` reads back off.
   */
  const asCloudFrontWrites = (queryString: string): string =>
    queryString
      .split("&")
      .map((pair) => {
        const [name = "", value = ""] = pair.split("=");

        return `${name}=${encodeURIComponent(value)}`;
      })
      .join("&");

  /** These events, delivered into the bucket the way CloudFront delivers. */
  const putDelivered = async (
    deployed: DeployedTable,
    sent: readonly SentEvent[],
  ): Promise<void> => {
    const records = sent.map((event) => ({
      "timestamp(ms)": String((event.at ?? theHour).getTime()),
      "cs-method": "GET",
      "cs-uri-stem": defaultBeaconPath,
      "cs-uri-query": asCloudFrontWrites(beaconQueryString(event)),
      "cs(User-Agent)": event.userAgent ?? "Mozilla/5.0",
      "c-ip": event.address,
    }));

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
  };

  /** The day the seeded hour falls in, which every case counts over. */
  const theDay = {
    from: new Date("2026-08-23T00:00:00.000Z"),
    to: new Date("2026-08-24T00:00:00.000Z"),
  };

  /** The rollup's own SQL, narrowed to the beacon's path. */
  const beaconSql = (over = {}): string =>
    rollupSql(
      beaconEvents,
      rollupRequest({ range: theDay, paths: [defaultBeaconPath], ...over }),
    );

  /** The rows the rollup answers with, run through the query engine. */
  const answered = async (
    deployed: DeployedTable,
    sql: string,
  ): Promise<readonly (readonly (string | undefined)[])[]> => {
    const athena = deployed.simAws.region("us-east-1").account().athena();
    const started = await athena.startQueryExecution({
      input: {
        QueryString: sql,
        QueryExecutionContext: { Database: defaultLogDataset.databaseName },
        ResultConfiguration: {
          OutputLocation: `s3://${deployed.resultsBucketName}/queries/`,
        },
      },
    });
    await deployed.simAws.backgroundTasksComplete();

    const id = started.QueryExecutionId ?? "";
    const execution = athena
      .queryExecutions()
      .find((each) => each.queryExecutionId === id);

    // Both of these, because a query the engine declined still succeeds and
    // answers from a declaration. Rows a fixture happens to agree with look
    // the same as rows a query produced, and this rule is arithmetic the
    // engine has to actually do.
    if (execution?.state !== "SUCCEEDED") {
      throw new Error(
        `The query did not succeed, so its rows prove nothing. ${
          execution?.stateChangeReason ?? "No reason was given."
        }`,
      );
    }

    if (execution.answeredBy !== "engine") {
      throw new Error(
        `The query was answered by a ${String(execution.answeredBy)} rather` +
          ` than run, so its rows prove nothing about the SQL.`,
      );
    }

    const results = await athena.getQueryResults({
      input: { QueryExecutionId: id },
    });

    return (results.ResultSet?.Rows ?? [])
      .slice(1)
      .map((row) => (row.Data ?? []).map((cell) => cell.VarCharValue));
  };

  /** A flood of one event, sent over and over from one client. */
  const flood = (
    times: number,
    event: BeaconEvent,
    over: Partial<SentEvent> = {},
  ): readonly SentEvent[] =>
    Array.from({ length: times }, () => ({
      ...event,
      address: "198.51.100.1",
      ...over,
    }));

  it("counts a flood as fewer events than it received", async () => {
    // Given one hour holding real events from five readers and a flood of the
    // same event from one client, sent five thousand times.
    const deployed = await deployTable();
    const event = { event: "route", page: "/liju/" };
    const readers = Array.from({ length: 5 }, (_unused, index) => ({
      ...event,
      address: `203.0.113.${String(index)}`,
    }));
    await putDelivered(deployed, [...readers, ...flood(5000, event)]);

    // When the question is asked of that hour.
    const rows = await answered(deployed, beaconSql());

    // Then the five readers are counted as five and the flood as the cap. The
    // collection path is open by design and nothing at the edge can keep a
    // count, so this is where a million requests stop being a million events.
    expect(rows).toStrictEqual([
      ["/liju/", "route", String(5 + beaconEventCap)],
    ]);
  });

  it("counts real traffic as it arrived", async () => {
    // Given an hour holding only what people did, with nobody near the cap.
    const deployed = await deployTable();
    const readers = Array.from({ length: 30 }, (_unused, index) => ({
      event: "route",
      page: "/grammar/",
      address: `203.0.113.${String(index)}`,
    }));
    await putDelivered(deployed, readers);

    // Then every one of them is counted. A rule that bounds a flood has to
    // leave a popular page alone, which is what a cap per visitor buys over a
    // cap per path.
    await expect(answered(deployed, beaconSql())).resolves.toStrictEqual([
      ["/grammar/", "route", "30"],
    ]);
  });

  it("caps one visitor on each page and each event separately", async () => {
    // Given one reader moving around a site, over the cap on two pages and
    // reporting two kinds of event on one of them.
    const deployed = await deployTable();
    const busy = beaconEventCap + 10;
    await putDelivered(deployed, [
      ...flood(busy, { event: "route", page: "/liju/" }),
      ...flood(busy, { event: "route", page: "/grammar/" }),
      ...flood(busy, { event: "vital", page: "/liju/" }),
    ]);

    // Then each pair is capped on its own. The cap is about one visitor
    // repeating one event on one page, and somebody reading a site produces
    // events on every page they open.
    await expect(answered(deployed, beaconSql())).resolves.toStrictEqual([
      ["/grammar/", "route", String(beaconEventCap)],
      ["/liju/", "route", String(beaconEventCap)],
      ["/liju/", "vital", String(beaconEventCap)],
    ]);
  });

  it("applies the cap to each hour a window holds", async () => {
    // Given a flood running through two hours of one day.
    const deployed = await deployTable();
    const event = { event: "click", page: "/" };
    await putDelivered(deployed, [
      ...flood(500, event, { at: theHour }),
      ...flood(500, event, {
        at: new Date("2026-08-23T10:30:00.000Z"),
      }),
    ]);

    // When the whole day is counted in one go.
    const rows = await answered(deployed, beaconSql());

    // Then it comes to the cap twice. The hour is the row's own rather than
    // the window being computed, so a day answers what its 24 hourly
    // summaries add up to, and one query text serves both cadences.
    expect(rows).toStrictEqual([["/", "click", String(2 * beaconEventCap)]]);
  });

  it("counts nothing a crawler sent", async () => {
    // Given a flood carrying a user agent that names itself.
    const deployed = await deployTable();
    await putDelivered(deployed, [
      ...flood(
        200,
        { event: "route", page: "/" },
        { userAgent: "SpamBot/1.0" },
      ),
      { event: "route", page: "/", address: "203.0.113.1" },
    ]);

    // Then the crawler filter every question applies has already taken them,
    // before the cap is reached for. The two rules stack, and the cap is
    // about a flood that says nothing about itself.
    await expect(answered(deployed, beaconSql())).resolves.toStrictEqual([
      ["/", "route", "1"],
    ]);
  });

  describe("the SQL it writes", () => {
    it("reads the beacon's own rows", () => {
      // Given the question narrowed to the collection path.
      const sql = beaconSql();

      // Then it counts GETs carrying an envelope version, under that path.
      // A request reaching the same path without one is a crawler following
      // a URL out of a page's source.
      expect(sql).toContain(`strpos(url_decode(url_decode(cs_uri_stem)),`);
      expect(sql).toContain(`'${defaultBeaconPath}') = 1`);
      expect(sql).toContain("cs_method = 'GET'");
    });

    it("leaves automated traffic out like every other question", () => {
      // Then the crawler filter is written by the shared builder rather than
      // by this question, which is what keeps it answering the same question
      // as its neighbours.
      expect(beaconSql()).toContain(
        `NOT regexp_like(lower(cs_user_agent), '${botUserAgentPattern}')`,
      );
    });

    it("prunes to the partitions the range covers", () => {
      // Then the partition predicate is inside the subquery, where it is the
      // only part deciding what the question reads and pays for.
      const sql = beaconSql();

      expect(sql).toContain("year IN ('2026')");
      expect(sql).toContain("day IN ('23', '24')");
    });

    it("takes the row limit it was given", () => {
      // Then a ranked answer is bounded the way every ranked answer is.
      expect(beaconSql({ limit: 3 })).toContain("LIMIT 3");
    });
  });

  it("adds its counts across stored windows", () => {
    // Then a reader asking about seven days adds the events of each window,
    // matched on the page and the event name beside them.
    expect(beaconEvents.totals).toStrictEqual({ added: ["events"] });
  });

  it("says it identifies viewers", () => {
    // Then a deployment whose delivery carries no address is refused rather
    // than left to fail hourly against a column that is not there. The cap
    // is keyed on the viewer, and there is no version of this question
    // without one.
    expect(beaconEvents.identifiesViewers).toBe(true);
  });

  it("is not one of the questions every deployment computes", () => {
    // Then a site with no beacon computes nothing for it. Layer 2 is
    // optional, and a scheduled question over rows nobody writes is an
    // Athena charge per window for an empty answer.
    expect(rollups).not.toContain(beaconEvents);
  });
});
