import { gzipSync } from "node:zlib";

import { AthenaClient } from "@aws-sdk/client-athena";
import { faker } from "@faker-js/faker";
import { SimSdk } from "@kensio/yulin/sdk";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { type App, CfnOutput, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { CloudFrontLogDelivery } from "../cdk/log-delivery.js";
import { LogBucket } from "../cdk/log-bucket.js";
import { LogTable } from "../cdk/log-table.js";
import { QueryWorkgroup } from "../cdk/query-workgroup.js";
import { partitionPrefix } from "../partitions.js";
import { rainlyticsCommands } from "./command.js";
import { runCli } from "./run.js";

describe("the named questions", () => {
  let intercepted: SimSdk | undefined;

  /**
   * When the traffic in these cases happened.
   *
   * The host clock, not the simulation's. `--last` is measured from the
   * moment the command runs, which is the real one, so the simulation is
   * moved to meet it rather than the other way round. Seeding at the fixed
   * instant `deployStacks` starts from would put every record outside every
   * range these cases ask for, and each of them would pass by answering
   * nothing.
   */
  const rightNow = new Date();

  /** The whole readable pipeline in a simulated account, SDK included. */
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

    await simAws.clock().setTo(rightNow);
    await simAws.region("us-east-1").account().athena().engine().enable();
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

  /** One record, with everything a rollup reads set to something sensible. */
  const aRecord = (
    at: Date,
    over: Readonly<Record<string, string>> = {},
  ): Readonly<Record<string, string>> => ({
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
    ...over,
  });

  /** One delivered object holding these records. */
  const putDelivered = async (
    deployed: Deployed,
    at: Date,
    records: readonly Readonly<Record<string, string>>[],
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
          ),
        },
      });
  };

  /** Runs the CLI the way the executable does, and reads both streams. */
  const cli = async (argv: readonly string[]) => {
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
        outIsTerminal: false,
      },
    });

    return { code, out, error, rows: out === "" ? [] : JSON.parse(out) };
  };

  /**
   * An hour of traffic covering everything the four rollups read.
   *
   * Written out rather than generated, because each rollup's expected answer
   * is counted off this list by hand and a random fixture would make every
   * assertion a restatement of the code under test.
   */
  const anHourOfTraffic = async (deployed: Deployed): Promise<void> => {
    const at = rightNow;

    await putDelivered(deployed, at, [
      // Two people looking at the home page, one of them arriving from
      // Google.
      aRecord(at),
      aRecord(at, { "cs(Referer)": "https://www.google.com/" }),
      // One looking at a second page, having come from the home page.
      aRecord(at, {
        "cs-uri-stem": "/grammar/",
        "cs(Referer)": "https://www.example.com/",
        "x-edge-result-type": "Miss",
      }),
      // A crawler, which every rollup leaves out by default.
      aRecord(at, {
        "cs-uri-stem": "/grammar/",
        "cs(User-Agent)": "Mozilla/5.0%20(compatible;%20ClaudeBot/1.0)",
        "cs(Referer)": "https://news.example.org/",
      }),
      // A stylesheet, which is a request rather than a pageview.
      aRecord(at, {
        "cs-uri-stem": "/app.css",
        "sc-content-type": "text/css",
      }),
      // A page that is not there, which the status codes count and the
      // pageviews do not.
      aRecord(at, {
        "cs-uri-stem": "/gone/",
        "sc-status": "404",
        "x-edge-result-type": "Error",
      }),
    ]);
  };

  it("counts the pages people looked at", async () => {
    // Given an hour of traffic holding two views of the home page, one of a
    // second page, and a stylesheet, a 404 and a crawler that are none of
    // those things.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);

    // When the pageviews are counted.
    const run = await cli(["pageviews", "--last", "24h"]);

    // Then only the pages count. The stylesheet answered `text/css`, the 404
    // did not succeed, and the crawler is filtered out below.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      { path: "/", views: "2" },
      { path: "/grammar/", views: "1" },
    ]);
  });

  it("counts what people typed into a search box", async () => {
    // Given an hour of searching. 家 was searched three times, twice
    // answered with a redirect to the page for it and once with a list.
    // CloudFront records the term percent-encoded twice.
    const deployed = await deployAnalytics();
    const search = { "cs-uri-stem": "/search/" };

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, {
        ...search,
        "cs-uri-query": "q=%25E5%25AE%25B6",
        "sc-status": "302",
      }),
      aRecord(rightNow, {
        ...search,
        "cs-uri-query": "q=%25E5%25AE%25B6",
        "sc-status": "302",
      }),
      aRecord(rightNow, { ...search, "cs-uri-query": "q=%25E5%25AE%25B6" }),
      aRecord(rightNow, { ...search, "cs-uri-query": "q=talent" }),
      // Somebody who opened the search page without searching.
      aRecord(rightNow, search),
      // A query string somewhere else on the site, which is a different
      // question asked of the same log.
      aRecord(rightNow, {
        "cs-uri-stem": "/tools/convert/",
        "cs-uri-query": "hanzi=%25E5%25AE%25B6",
      }),
    ]);

    // When the searches under the search page are counted.
    const run = await cli(["searches", "--last", "24h", "--path", "/search/"]);

    // Then the terms read as somebody typed them, the redirects are counted
    // beside them, and the tool's own parameter is left out.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      { term: "家", searches: "3", redirected: "2" },
      { term: "talent", searches: "1", redirected: "0" },
    ]);
  });

  it("leaves a search that was only sent to a tidier address alone", async () => {
    // Given a site normalising a missing trailing slash. One reader typed
    // `happy` at `/search`, got a 308 to `/search/`, and their term is on
    // both records. Another was sent to the page for 家 with a 302.
    const deployed = await deployAnalytics();

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, {
        "cs-uri-stem": "/search",
        "cs-uri-query": "q=happy",
        "sc-status": "308",
      }),
      aRecord(rightNow, {
        "cs-uri-stem": "/search/",
        "cs-uri-query": "q=happy",
      }),
      aRecord(rightNow, {
        "cs-uri-stem": "/search/",
        "cs-uri-query": "q=%25E5%25AE%25B6",
        "sc-status": "302",
      }),
    ]);

    // When the searches are counted.
    const run = await cli(["searches", "--last", "24h", "--path", "/search"]);

    // Then `happy` found nothing. A permanent redirect is address tidying,
    // and a reader gets one whatever they typed. Counting the 308 would
    // report `happy` as a term the site publishes a page for, on the same
    // line as the term it does publish one for.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      { term: "happy", searches: "2", redirected: "0" },
      { term: "家", searches: "1", redirected: "1" },
    ]);
  });

  it("counts the statuses it was told to count as redirects", async () => {
    // Given a site whose exact match answers 301.
    const deployed = await deployAnalytics();
    const search = { "cs-uri-stem": "/search/" };

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, {
        ...search,
        "cs-uri-query": "q=happy",
        "sc-status": "301",
      }),
      aRecord(rightNow, { ...search, "cs-uri-query": "q=happy" }),
    ]);

    // When it names that status.
    const run = await cli([
      "searches",
      "--last",
      "24h",
      "--path",
      "/search/",
      "--redirect-status",
      "301,302",
    ]);

    // Then the column is right for that site. One value carrying commas,
    // where `--path` is given again for each path.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      { term: "happy", searches: "2", redirected: "1" },
    ]);
  });

  it("refuses a redirect status that is not one", async () => {
    // Given a value that is not a list of status codes.
    const run = await cli(["searches", "--redirect-status", "3xx"]);

    // Then it says what it takes before anything reaches Athena, the way a
    // mistyped row count does.
    expect(run.code).toBe(2);
    expect(run.error).toContain("--redirect-status takes HTTP status codes");
    expect(run.error).toContain('Run "rainlytics searches --help"');
  });

  it("leaves the redirect statuses off a question that counts none", async () => {
    // Given a rollup counting every response as it came.
    const run = await cli(["pageviews", "--redirect-status", "302"]);

    // Then it has no redirects to be told about. The option sits on the one
    // question separating a search sent to its answer from one that produced
    // a list, the way `--param` sits on the one that reads a parameter.
    expect(run.code).toBe(2);
    expect(run.error).toContain("--redirect-status");
  });

  it("counts two spellings of one search as one term", async () => {
    // Given the same search submitted from a form and from a hand-written
    // link. One sends `+` for the space and the other `%20`, which reaches
    // the log as `%2520`.
    const deployed = await deployAnalytics();
    const search = { "cs-uri-stem": "/search/" };

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, { ...search, "cs-uri-query": "q=old+man" }),
      aRecord(rightNow, { ...search, "cs-uri-query": "q=old%2520man" }),
    ]);

    // When the searches are counted.
    const run = await cli(["searches", "--last", "24h", "--path", "/search/"]);

    // Then they are one row. Two rows would split one question in half and
    // rank both below a term nobody had trouble spelling.
    expect(run.rows).toStrictEqual([
      { term: "old man", searches: "2", redirected: "0" },
    ]);
  });

  it("reads a search from the parameter it is told to", async () => {
    // Given a legacy tool taking a parameter of its own name.
    const deployed = await deployAnalytics();

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, {
        "cs-uri-stem": "/tools/convert/",
        "cs-uri-query": "hanzi=%25E5%25AE%25B6",
      }),
    ]);

    // When that parameter is named.
    const run = await cli([
      "searches",
      "--last",
      "24h",
      "--path",
      "/tools/",
      "--param",
      "hanzi",
    ]);

    // Then it is read the same way `q` would have been. One site can hold
    // several of these, and each is its own question.
    expect(run.rows).toStrictEqual([
      { term: "家", searches: "1", redirected: "0" },
    ]);
  });

  it("counts one section of the site when given a path", async () => {
    // Given traffic across two sections and a page above both of them.
    const deployed = await deployAnalytics();

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, { "cs-uri-stem": "/guides/one/" }),
      aRecord(rightNow, { "cs-uri-stem": "/guides/two/" }),
      aRecord(rightNow, { "cs-uri-stem": "/blog/one/" }),
      aRecord(rightNow, { "cs-uri-stem": "/" }),
    ]);

    // When the pageviews are counted under one of them.
    const run = await cli(["pageviews", "--last", "24h", "--path", "/guides/"]);

    // Then the other section and the page above both are left out. The
    // home page is a prefix of nothing here, which is what separates a
    // prefix match from a substring one.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      { path: "/guides/one/", views: "1" },
      { path: "/guides/two/", views: "1" },
    ]);
  });

  it("counts several sections that share no prefix", async () => {
    // Given a site with two search boxes and no path covering both. A third
    // tool alongside them takes the same parameter and is a different
    // question.
    const deployed = await deployAnalytics();

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, {
        "cs-uri-stem": "/words/search/",
        "cs-uri-query": "q=talent",
      }),
      aRecord(rightNow, {
        "cs-uri-stem": "/words/search/",
        "cs-uri-query": "q=talent",
      }),
      aRecord(rightNow, {
        "cs-uri-stem": "/sentences/search/",
        "cs-uri-query": "q=talent",
      }),
      aRecord(rightNow, {
        "cs-uri-stem": "/sentences/search/",
        "cs-uri-query": "q=weather",
      }),
      aRecord(rightNow, {
        "cs-uri-stem": "/tools/convert/",
        "cs-uri-query": "q=talent",
      }),
    ]);

    // When both search pages are named.
    const run = await cli([
      "searches",
      "--last",
      "24h",
      "--path",
      "/words/search/",
      "--path",
      "/sentences/search/",
    ]);

    // Then a row under either is counted and one under neither is left out.
    // Each row carries the box it came from, so the term searched in both
    // is two rows and each says which corpus answered it. One run reads
    // both, where two would have been two questions.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      {
        term: "talent",
        section: "/words/search/",
        searches: "2",
        redirected: "0",
      },
      {
        term: "talent",
        section: "/sentences/search/",
        searches: "1",
        redirected: "0",
      },
      {
        term: "weather",
        section: "/sentences/search/",
        searches: "1",
        redirected: "0",
      },
    ]);
  });

  it("names no section where one search page was asked for", async () => {
    // Given the same two boxes, with one of them asked about.
    const deployed = await deployAnalytics();

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, {
        "cs-uri-stem": "/words/search/",
        "cs-uri-query": "q=talent",
      }),
      aRecord(rightNow, {
        "cs-uri-stem": "/sentences/search/",
        "cs-uri-query": "q=talent",
      }),
    ]);

    // When one path is given.
    const run = await cli([
      "searches",
      "--last",
      "24h",
      "--path",
      "/words/search/",
    ]);

    // Then the answer is the terms alone. Every row would carry the same
    // section, and a column repeating one value tells the reader what they
    // typed.
    expect(run.code).toBe(0);
    expect(run.rows).toStrictEqual([
      { term: "talent", searches: "1", redirected: "0" },
    ]);
  });

  it("matches a path holding an underscore literally", async () => {
    // Given two pages whose addresses differ only where LIKE would read a
    // wildcard.
    const deployed = await deployAnalytics();

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, { "cs-uri-stem": "/a_b/" }),
      aRecord(rightNow, { "cs-uri-stem": "/axb/" }),
    ]);

    // When one of them is asked for.
    const run = await cli(["pageviews", "--last", "24h", "--path", "/a_b/"]);

    // Then only that one is counted. An unescaped LIKE would have counted
    // both, and the count would have looked right.
    expect(run.rows).toStrictEqual([{ path: "/a_b/", views: "1" }]);
  });

  it("counts one of the hosts a distribution serves", async () => {
    // Given one distribution serving two sites.
    const deployed = await deployAnalytics();

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, { "x-host-header": "docs.example.com" }),
      aRecord(rightNow, { "x-host-header": "docs.example.com" }),
      aRecord(rightNow, { "x-host-header": "www.example.com" }),
    ]);

    // When one host is asked for.
    const run = await cli([
      "status-codes",
      "--last",
      "24h",
      "--host",
      "docs.example.com",
    ]);

    // Then the other site's requests are left out.
    expect(run.rows).toStrictEqual([{ status: "200", responses: "2" }]);
  });

  it("reads a path back out of CloudFront's encoding", async () => {
    // Given two views of a page whose address holds characters outside
    // ASCII, delivered the way CloudFront delivers one. The browser encodes
    // 好 as `%E5%A5%BD` and CloudFront encodes that again, so the log holds
    // `%25E5%25A5%25BD`.
    const deployed = await deployAnalytics();
    const encoded = "/words/%25E5%25A5%25BD/";

    await putDelivered(deployed, rightNow, [
      aRecord(rightNow, { "cs-uri-stem": encoded }),
      aRecord(rightNow, { "cs-uri-stem": encoded }),
      aRecord(rightNow, { "cs-uri-stem": "/words/%25E4%25BA%25BA/" }),
    ]);

    // When the pageviews are counted.
    const run = await cli(["pageviews", "--last", "24h"]);

    // Then the address reads as the reader would recognise it. One pass
    // would answer `/words/%E5%A5%BD/`, which is the URI the browser sent
    // and is no more readable than the record.
    expect(run.rows).toStrictEqual([
      { path: "/words/好/", views: "2" },
      { path: "/words/人/", views: "1" },
    ]);
  });

  it("counts where people arrived from, and leaves this site out", async () => {
    // Given the same hour, in which one person arrived from Google and one
    // moved between two pages of this site.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);

    // When the referrers are counted.
    const run = await cli(["referrers", "--last", "24h"]);

    // Then Google is the only one. The referral from this site's own host is
    // somebody moving around rather than arriving, and the crawler's is
    // filtered out with the crawler.
    expect(run.rows).toStrictEqual([
      { referrer: "www.google.com", views: "1" },
    ]);
  });

  it("counts every response, whatever it answered", async () => {
    // Given the same hour, holding a 404 among the successes.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);

    // When the status codes are counted.
    const run = await cli(["status-codes", "--last", "24h"]);

    // Then the stylesheet is in there too, unlike in the pageview count.
    // A stylesheet returning 404 is worth seeing and a rollup looking only
    // at pages never would.
    expect(run.rows).toStrictEqual([
      { status: "200", responses: "4" },
      { status: "404", responses: "1" },
    ]);
  });

  it("works out how much came from the cache", async () => {
    // Given the same hour, holding three hits, one miss and one error.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);

    // When the cache hit ratio is asked for.
    const run = await cli(["cache-hit-ratio", "--last", "24h"]);

    // Then it is counted over the requests the cache had a say in. Three of
    // the five non-crawler requests were served from cache and one was a
    // miss. The error is not one the cache was asked about, so it moves
    // neither the count nor the ratio.
    const [ratio] = run.rows as Readonly<Record<string, string>>[];
    expect(ratio?.["hits"]).toBe("3");
    expect(ratio?.["misses"]).toBe("1");
    expect(Number(ratio?.["hit_percent"])).toBe(75);
  });

  it("leaves crawlers out until it is told not to", async () => {
    // Given an hour in which a crawler looked at a page nobody else did.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);

    // When the pages are counted both ways.
    const filtered = await cli(["pageviews", "--last", "24h"]);
    const everything = await cli([
      "pageviews",
      "--last",
      "24h",
      "--include-bots",
    ]);

    // Then the crawler's view appears only in the second. Bots are most of a
    // quiet site's traffic, so the default is the number that says something
    // about people, and the flag is what makes the difference visible rather
    // than hidden.
    expect(filtered.rows).toStrictEqual([
      { path: "/", views: "2" },
      { path: "/grammar/", views: "1" },
    ]);
    expect(everything.rows).toStrictEqual([
      { path: "/", views: "2" },
      { path: "/grammar/", views: "2" },
    ]);
  });

  it("answers with as many rows as it was asked for", async () => {
    // Given traffic across three pages.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);

    // When only the top one is wanted.
    const run = await cli(["pageviews", "--last", "24h", "--limit", "1"]);

    // Then that is what comes back.
    expect(run.rows).toStrictEqual([{ path: "/", views: "2" }]);
  });

  it("reads only the partitions the range covers", async () => {
    // Given an hour of traffic today and a much larger day a fortnight ago.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);
    const longAgo = new Date(rightNow.getTime() - 14 * 86_400_000);
    await putDelivered(
      deployed,
      longAgo,
      Array.from({ length: 400 }, () => aRecord(longAgo)),
    );

    // When the same question is asked over a day and over a month.
    //
    // Both with `--include-bots`, which is what makes this measurable here.
    // Simulated Athena gives up on partition filtering for any query
    // carrying a `NOT` anywhere, and the default bot filter is one. Real
    // Athena prunes on the partition predicate whatever else the `WHERE`
    // holds. See KensioSoftware/yulin, where that conservatism is reported.
    const aDay = await cli(["pageviews", "--last", "24h", "--include-bots"]);
    const aMonth = await cli(["pageviews", "--last", "4w", "--include-bots"]);

    // Then the shorter range reads less. `--last` becomes partition
    // predicates rather than a filter on the record's own timestamp, which
    // would answer the same and read everything to do it.
    expect(scannedBytes(aDay.error)).toBeLessThan(scannedBytes(aMonth.error));

    // And the longer one finds what the shorter one could not reach.
    expect(aMonth.rows[0]).toStrictEqual({ path: "/", views: "402" });
  });

  it("reports a rollup Athena would not run", async () => {
    // Given a deployment, and a command naming a workgroup nobody created.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);

    // When a rollup is asked for there.
    const run = await cli([
      "pageviews",
      "--last",
      "24h",
      "--workgroup",
      "not-a-workgroup",
    ]);

    // Then it fails the way `query` does, since the two run the same way
    // once the SQL is written. A rollup in the wrong workgroup is a rollup
    // with no ceiling on it.
    expect(run.code).toBe(1);
    expect(run.error).toContain("not-a-workgroup");
  });

  it("asks Athena in the region it was told to", async () => {
    // Given a deployment in us-east-1, and a rollup asked for somewhere else.
    const deployed = await deployAnalytics();
    await anHourOfTraffic(deployed);

    // When the region is named on a named question rather than on `query`.
    const run = await cli([
      "pageviews",
      "--last",
      "24h",
      "--region",
      "eu-west-1",
    ]);

    // Then it goes there, finds no workgroup, and says where it looked.
    // Every command that reaches Athena takes the region, since the four
    // named questions run the same way `query` does once the SQL is written.
    expect(run.code).toBe(1);
    expect(run.error).toContain("WorkGroup rainlytics is not found");
    expect(run.error).toContain("Athena was asked in eu-west-1");
  });

  it("refuses a span it cannot read", async () => {
    // Given a range nobody could act on.
    const run = await cli(["pageviews", "--last", "a fortnight"]);

    // Then it says what it takes, and exits as the command-line mistake it
    // is rather than as a query that failed.
    expect(run.code).toBe(2);
    expect(run.error).toContain("24h, 7d or 2w");
    expect(run.error).toContain('Run "rainlytics pageviews --help"');
  });

  it("refuses a row count that is not one", async () => {
    // Given a limit that is not a whole number.
    const run = await cli(["pageviews", "--limit", "lots"]);

    // Then it says so before running anything.
    expect(run.code).toBe(2);
    expect(run.error).toContain("--limit takes a whole number");
  });

  /** The bytes a scan report names, whichever unit it wrote them in. */
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
