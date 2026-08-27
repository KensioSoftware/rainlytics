import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { defaultLogDataset, qualifiedTableName } from "./dataset.js";
import { rollups } from "./rollup-questions.js";
import type { Rollup } from "./rollups.js";
import {
  assertRollupName,
  botUserAgentPattern,
  currentMonth,
  rollupRequest,
  rollupSql,
  rowsFor,
} from "./rollups.js";

describe("the SQL a rollup runs", () => {
  const aWeek = {
    from: new Date("2026-08-20T00:00:00Z"),
    to: new Date("2026-08-27T00:00:00Z"),
  };

  const sqlFor = (name: string, over = {}): string => {
    const rollup = rollups.find((each) => each.name === name);

    if (rollup === undefined) {
      throw new Error(`No rollup called ${name}.`);
    }

    return rollupSql(rollup, rollupRequest({ range: aWeek, ...over }));
  };

  it.each(rollups.map((rollup) => rollup.name))(
    "reads %s from the one table definition",
    (name) => {
      // Given a rollup over the default dataset.
      // Then it names the table the constructs create, qualified by its
      // database. Writing either out here would be a second definition, and
      // the one that drifts is the one nothing deploys.
      expect(sqlFor(name)).toContain(
        `"${defaultLogDataset.databaseName}"."${defaultLogDataset.tableName}"`,
      );
    },
  );

  it.each(rollups.map((rollup) => rollup.name))(
    "prunes %s to the partitions the range covers",
    (name) => {
      // Given a week in August.
      const sql = sqlFor(name);

      // Then the partition keys are pinned to the values that week touches.
      // This is the part that decides what the query costs. Everything after
      // it narrows rows already paid for.
      expect(sql).toContain("year IN ('2026')");
      expect(sql).toContain("month IN ('08')");
      expect(sql).toContain(
        "day IN ('20', '21', '22', '23', '24', '25', '26', '27')",
      );
    },
  );

  it.each(rollups.map((rollup) => rollup.name))(
    "narrows %s to the exact span inside those partitions",
    (name) => {
      // Given the same week.
      // Then the record's own timestamp bounds it too. The partition values
      // are a cross product, so a range crossing a month reads days at both
      // ends that fall outside it, and this is what leaves their rows out.
      expect(sqlFor(name)).toContain(
        `cast(timestamp_ms AS bigint) BETWEEN ${String(aWeek.from.getTime())}` +
          ` AND ${String(aWeek.to.getTime())}`,
      );
    },
  );

  it.each(rollups.map((rollup) => rollup.name))(
    "leaves automated traffic out of %s by default",
    (name) => {
      // Given a rollup nobody asked to include bots in.
      // Then the filter is there, matched against a lowercased user agent so
      // that every engine reads the pattern the same way.
      expect(sqlFor(name)).toContain(
        `NOT regexp_like(lower(cs_user_agent), '${botUserAgentPattern}')`,
      );
    },
  );

  it.each(rollups.map((rollup) => rollup.name))(
    "counts automated traffic in %s when asked",
    (name) => {
      // Given a rollup told to include bots.
      // Then nothing filters on the user agent at all.
      expect(sqlFor(name, { includeBots: true })).not.toContain(
        "cs_user_agent",
      );
    },
  );

  it("counts a pageview as an HTML response somebody got", () => {
    // Given the pageviews rollup.
    const sql = sqlFor("pageviews");

    // Then it is a GET that answered HTML and succeeded, which is what
    // separates a page from the assets the same log records.
    expect(sql).toContain("cs_method = 'GET'");
    expect(sql).toContain("sc_content_type LIKE 'text/html%'");
    expect(sql).toContain("sc_status IN ('200', '304')");
  });

  it.each(rollups.map((rollup) => rollup.name))(
    "narrows %s to one section of the site",
    (name) => {
      // Given a rollup asked for one path.
      const sql = sqlFor(name, { paths: ["/guides/"] });

      // Then it matches a prefix of the decoded path, so the option names
      // the address a reader sees. `strpos` takes the text literally, where
      // LIKE would read a path holding `_` as a wildcard.
      expect(sql).toContain(
        "strpos(url_decode(url_decode(cs_uri_stem)), '/guides/') = 1",
      );

      // And nothing is bracketed or joined by OR. One section asked for
      // writes what it has always written, since a set of one is a set.
      expect(sql).not.toContain(" OR ");
    },
  );

  it.each(rollups.map((rollup) => rollup.name))(
    "narrows %s to several sections at once",
    (name) => {
      // Given a rollup asked for two sections that share no prefix.
      const sql = sqlFor(name, { paths: ["/guides/", "/tutorials/"] });

      // Then a row counts when it starts with either, and the branches are
      // bracketed. Without the bracket the `AND` above would take the first
      // one and the rest of the WHERE clause would answer a different
      // question.
      expect(sql).toContain(
        "(strpos(url_decode(url_decode(cs_uri_stem)), '/guides/') = 1" +
          " OR strpos(url_decode(url_decode(cs_uri_stem)), '/tutorials/') = 1)",
      );
    },
  );

  it.each(rollups.map((rollup) => rollup.name))(
    "narrows %s to one of the hosts a distribution serves",
    (name) => {
      // Given a rollup asked for one host.
      // Then it matches in full. A site and its www name are two hosts, and
      // a suffix match would quietly fold them together.
      expect(sqlFor(name, { host: "docs.example.com" })).toContain(
        "x_host_header = 'docs.example.com'",
      );
    },
  );

  it.each(rollups.map((rollup) => rollup.name))(
    "leaves %s over the whole distribution by default",
    (name) => {
      // Given a rollup nobody narrowed, and one narrowed to no paths at all.
      // The command line hands over an empty list when `--path` was never
      // given, so the two arrive here as the same question.
      for (const sql of [sqlFor(name), sqlFor(name, { paths: [] })]) {
        // Then neither filter is written at all, rather than written as a
        // condition matching everything.
        expect(sql).not.toContain("x_host_header =");
        expect(sql).not.toContain("strpos(");
      }
    },
  );

  it("takes a path holding a quote without breaking the statement", () => {
    // Given a path carrying the one character SQL string syntax cares about.
    // Then it is doubled, so the statement still parses and still means the
    // path that was asked for.
    expect(sqlFor("pageviews", { paths: ["/it's/"] })).toContain("'/it''s/'");
  });

  it("reads CloudFront's encoding back off the path", () => {
    // Given the pageviews rollup.
    const sql = sqlFor("pageviews");

    // Then the path is decoded twice, which is what CloudFront encoded it.
    // One pass answers the URI as the browser sent it, which is the shape
    // this reads like when it is half done.
    expect(sql).toContain("url_decode(url_decode(cs_uri_stem)) AS path");
  });

  it("leaves the other rollups' columns as they were delivered", () => {
    // Given the three rollups that read no path.
    // Then none of them decodes anything. The referrer is read for its host,
    // which is ASCII whatever the rest of the URL holds, and a status code
    // and a result type carry no encoding at all.
    expect(sqlFor("referrers")).not.toContain("url_decode");
    expect(sqlFor("status-codes")).not.toContain("url_decode");
    expect(sqlFor("cache-hit-ratio")).not.toContain("url_decode");
  });

  it("leaves this site out of its own referrers", () => {
    // Given the referrers rollup.
    const sql = sqlFor("referrers");

    // Then a referral from the host being measured is left out, since that
    // is somebody moving around rather than arriving.
    expect(sql).toContain("url_extract_host(cs_referer) <> x_host_header");
    expect(sql).toContain("cs_referer <> '-'");
  });

  it("counts the cache over the requests it had a say in", () => {
    // Given the cache hit ratio.
    const sql = sqlFor("cache-hit-ratio");

    // Then the denominator is hits and misses, and not every request. A
    // redirect or an error is one the cache was never asked about, and
    // counting those would move the ratio without the cache having changed.
    expect(sql).toContain(
      "x_edge_result_type IN ('Hit', 'RefreshHit', 'Miss')",
    );
    expect(sql).toContain("nullif(");
  });

  it("takes as many rows as a ranked rollup was asked for", () => {
    // Given a limit.
    // Then the ranked rollups carry it, and the one answering a single row
    // has nothing to limit.
    expect(sqlFor("pageviews", { limit: 5 })).toContain("LIMIT 5");
    expect(sqlFor("cache-hit-ratio", { limit: 5 })).not.toContain("LIMIT");
  });

  it("breaks a tie the same way every time", () => {
    // Given a ranked rollup.
    // Then the order names the counted column and then the thing counted.
    // Two paths with the same views are otherwise ordered however the engine
    // finds convenient, and a person comparing two runs wants the same
    // answer twice.
    expect(sqlFor("pageviews")).toContain("ORDER BY 2 DESC, 1");
  });

  it("writes a standing range for a copy nobody can date", () => {
    // Given a rollup saved rather than run, which has no range to compute.
    const sql = sqlFor("pageviews", { range: currentMonth });

    // Then it asks Athena what month it is. Dates baked in at deploy time
    // would be the dates of whoever last deployed, and would go stale
    // without anybody being told.
    expect(sql).toContain("year = date_format(current_date, '%Y')");
    expect(sql).toContain("month = date_format(current_date, '%m')");
    expect(sql).not.toContain("timestamp_ms");
  });
});

describe("a rollup a site wrote for itself", () => {
  const aWeek = {
    from: new Date("2026-08-20T00:00:00Z"),
    to: new Date("2026-08-27T00:00:00Z"),
  };

  /**
   * A question Rainlytics does not ship, built the way the four are built.
   *
   * This is the shape the docs describe, and until the builder was exported
   * it was a shape nobody outside the package could write. The reference
   * site had a hand-written copy of `rowsFor` for exactly this.
   */
  const countries: Rollup = {
    name: "countries",
    summary: "Count views by country.",
    description: "Counts where readers were, most read from first.",
    isRanked: true,
    body: (request) =>
      [
        "SELECT c_country AS country, count(*) AS views",
        `  FROM ${qualifiedTableName(request.dataset)}`,
        rowsFor(request, ["sc_content_type LIKE 'text/html%'"]),
        "  GROUP BY 1",
      ].join("\n"),
  };

  const sqlFor = (over = {}): string =>
    rollupSql(countries, rollupRequest({ range: aWeek, ...over }));

  it("prunes to the same partitions the built-in ones prune to", () => {
    // Given a week in August, asked for by a rollup nobody here wrote.
    const sql = sqlFor();

    // Then the partition predicate is the one the four carry. This is the
    // part that decides what Athena bills for, and a site writing its own
    // copy of it is a site one edit away from reading a year of objects.
    expect(sql).toContain("year IN ('2026')");
    expect(sql).toContain("month IN ('08')");
    expect(sql).toContain(
      `cast(timestamp_ms AS bigint) BETWEEN ${String(aWeek.from.getTime())}` +
        ` AND ${String(aWeek.to.getTime())}`,
    );
  });

  it("leaves automated traffic out on the same terms", () => {
    // Given the same question.
    // Then the bot filter is the one Rainlytics argues for, written once.
    expect(sqlFor()).toContain(
      `NOT regexp_like(lower(cs_user_agent), '${botUserAgentPattern}')`,
    );
  });

  it("takes the host and the path a caller narrowed to", () => {
    // Given a question narrowed the way every rollup can be narrowed.
    const sql = sqlFor({ host: "example.com", paths: ["/words/"] });

    // Then it narrows without the question having said how. A site asking
    // for `--host` would otherwise write the column name itself.
    expect(sql).toContain("x_host_header = 'example.com'");
    expect(sql).toContain("'/words/') = 1");
  });

  it("carries the conditions its own question adds", () => {
    // Given a question that reads the HTML responses alone.
    // Then its own condition joins the rest.
    expect(sqlFor()).toContain("AND sc_content_type LIKE 'text/html%'");
  });
});

describe("what a rollup may be called", () => {
  it.each(rollups.map((rollup) => rollup.name))("takes %s", (name) => {
    // Given a name one of the built-in four carries.
    // Then nothing objects. The rule has to admit the names already
    // deployed, or the first thing it refuses is Rainlytics itself.
    expect(() => {
      assertRollupName(name);
    }).not.toThrow();
  });

  it.each([
    ["a capital", "Status-Codes"],
    ["a space", "status codes"],
    ["an underscore", "status_codes"],
    ["a leading hyphen", "-searches"],
    ["a trailing hyphen", "searches-"],
    ["a leading digit", "404s"],
    ["nothing at all", ""],
  ])("refuses a name carrying %s", (_what, name) => {
    // Given a name a subcommand could not carry.
    const naming = (): void => {
      assertRollupName(name);
    };

    // Then it is refused where somebody can still change it. The same name
    // becomes a CDK logical id and an Athena named query, and neither says
    // anything useful when it arrives malformed.
    expect(naming).toThrow(/lowercase words/u);
  });

  it("names what it refused, so the message can be acted on", () => {
    // Given a name that will not do.
    const name = faker.word.noun().toUpperCase();

    // Then the refusal quotes it back.
    expect(() => {
      assertRollupName(name);
    }).toThrow(name);
  });
});
