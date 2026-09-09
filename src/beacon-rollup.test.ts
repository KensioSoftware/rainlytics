import {
  assertArrayNotIncludes,
  assertObjectEquals,
  assertStringIncludes,
  assertTrue,
} from "@kensio/smartass";

import { describe, it } from "vitest";

import { answeredRows } from "#test/answered-rows.js";
import {
  deployBeaconTable,
  putDeliveredEvents,
  type SentEvent,
  theBeaconDay,
  theBeaconHour,
} from "#test/delivered-beacon-events.js";

import { type BeaconEvent, defaultBeaconPath } from "./beacon-events.js";
import { beaconEventCap, beaconEvents } from "./beacon-rollup.js";
import { botUserAgentPattern, rollups } from "./index.js";
import { rollupRequest, rollupSql } from "./rollups.js";

describe("counting what the beacon reported", () => {
  /** The rollup's own SQL, narrowed to the beacon's path. */
  const beaconSql = (over = {}): string =>
    rollupSql(
      beaconEvents,
      rollupRequest({
        range: theBeaconDay,
        paths: [defaultBeaconPath],
        ...over,
      }),
    );

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
    const deployed = await deployBeaconTable();
    const event = { event: "route", page: "/liju/" };
    const readers = Array.from({ length: 5 }, (_unused, index) => ({
      ...event,
      address: `203.0.113.${String(index)}`,
    }));
    await putDeliveredEvents(deployed, [...readers, ...flood(5000, event)]);

    // When the question is asked of that hour.
    const rows = await answeredRows(deployed, beaconSql());

    // Then the five readers are counted as five and the flood as the cap. The
    // collection path is open by design and nothing at the edge can keep a
    // count, so this is where a million requests stop being a million events.
    assertObjectEquals(rows, [["/liju/", "route", String(5 + beaconEventCap)]]);
  });

  it("counts real traffic as it arrived", async () => {
    // Given an hour holding only what people did, with nobody near the cap.
    const deployed = await deployBeaconTable();
    const readers = Array.from({ length: 30 }, (_unused, index) => ({
      event: "route",
      page: "/grammar/",
      address: `203.0.113.${String(index)}`,
    }));
    await putDeliveredEvents(deployed, readers);

    // Then every one of them is counted. A rule that bounds a flood has to
    // leave a popular page alone, which is what a cap per visitor buys over a
    // cap per path.
    assertObjectEquals(await answeredRows(deployed, beaconSql()), [
      ["/grammar/", "route", "30"],
    ]);
  });

  it("caps one visitor on each page and each event separately", async () => {
    // Given one reader moving around a site, over the cap on two pages and
    // reporting two kinds of event on one of them.
    const deployed = await deployBeaconTable();
    const busy = beaconEventCap + 10;
    await putDeliveredEvents(deployed, [
      ...flood(busy, { event: "route", page: "/liju/" }),
      ...flood(busy, { event: "route", page: "/grammar/" }),
      ...flood(busy, { event: "vital", page: "/liju/" }),
    ]);

    // Then each pair is capped on its own. The cap is about one visitor
    // repeating one event on one page, and somebody reading a site produces
    // events on every page they open.
    assertObjectEquals(await answeredRows(deployed, beaconSql()), [
      ["/grammar/", "route", String(beaconEventCap)],
      ["/liju/", "route", String(beaconEventCap)],
      ["/liju/", "vital", String(beaconEventCap)],
    ]);
  });

  it("applies the cap to each hour a window holds", async () => {
    // Given a flood running through two hours of one day.
    const deployed = await deployBeaconTable();
    const event = { event: "click", page: "/" };
    await putDeliveredEvents(deployed, [
      ...flood(500, event, { at: theBeaconHour }),
      ...flood(500, event, {
        at: new Date("2026-08-23T10:30:00.000Z"),
      }),
    ]);

    // When the whole day is counted in one go.
    const rows = await answeredRows(deployed, beaconSql());

    // Then it comes to the cap twice. The hour is the row's own rather than
    // the window being computed, so a day answers what its 24 hourly
    // summaries add up to, and one query text serves both cadences.
    assertObjectEquals(rows, [["/", "click", String(2 * beaconEventCap)]]);
  });

  it("counts nothing a crawler sent", async () => {
    // Given a flood carrying a user agent that names itself.
    const deployed = await deployBeaconTable();
    await putDeliveredEvents(deployed, [
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
    assertObjectEquals(await answeredRows(deployed, beaconSql()), [
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
      assertStringIncludes(sql, `strpos(url_decode(url_decode(cs_uri_stem)),`);
      assertStringIncludes(sql, `'${defaultBeaconPath}') = 1`);
      assertStringIncludes(sql, "cs_method = 'GET'");
    });

    it("leaves automated traffic out like every other question", () => {
      // Then the crawler filter is written by the shared builder rather than
      // by this question, which is what keeps it answering the same question
      // as its neighbours.
      assertStringIncludes(
        beaconSql(),
        `NOT regexp_like(lower(cs_user_agent), '${botUserAgentPattern}')`,
      );
    });

    it("prunes to the partitions the range covers", () => {
      // Then the partition predicate is inside the subquery, where it is the
      // only part deciding what the question reads and pays for.
      const sql = beaconSql();

      assertStringIncludes(sql, "year IN ('2026')");
      assertStringIncludes(sql, "day IN ('23', '24')");
    });

    it("takes the row limit it was given", () => {
      // Then a ranked answer is bounded the way every ranked answer is.
      assertStringIncludes(beaconSql({ limit: 3 }), "LIMIT 3");
    });
  });

  it("adds its counts across stored windows", () => {
    // Then a reader asking about seven days adds the events of each window,
    // matched on the page and the event name beside them.
    assertObjectEquals(beaconEvents.totals, { added: ["events"] });
  });

  it("says it identifies viewers", () => {
    // Then a deployment whose delivery carries no address is refused rather
    // than left to fail hourly against a column that is not there. The cap
    // is keyed on the viewer, and there is no version of this question
    // without one.
    assertTrue(beaconEvents.identifiesViewers);
  });

  it("is not one of the questions every deployment computes", () => {
    // Then a site with no beacon computes nothing for it. Layer 2 is
    // optional, and a scheduled question over rows nobody writes is an
    // Athena charge per window for an empty answer.
    assertArrayNotIncludes(rollups, beaconEvents);
  });
});
