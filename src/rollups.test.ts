import { describe, expect, it } from "vitest";

import { defaultLogDataset } from "./dataset.js";
import { rollups } from "./rollup-questions.js";
import {
  botUserAgentPattern,
  currentMonth,
  rollupRequest,
  rollupSql,
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
