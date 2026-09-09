import {
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

import { defaultBeaconPath } from "./beacon-events.js";
import { beaconTotalCap, beaconTotals } from "./beacon-totals-rollup.js";
import { errorEventNames } from "./error-events.js";
import { rollups } from "./index.js";
import { rollupRequest, rollupSql } from "./rollups.js";
import { vitalEventNames } from "./vital-events.js";

describe("totalling what beacon events measured", () => {
  /** The rollup's own SQL, over one span, narrowed to the beacon's path. */
  const totalsSql = (over = {}): string =>
    rollupSql(
      beaconTotals,
      rollupRequest({
        range: theBeaconDay,
        paths: [defaultBeaconPath],
        ...over,
      }),
    );

  /** One purchase from one reader, at a price in pence. */
  const purchase = (pence: number, from: number): SentEvent => ({
    event: "purchase",
    page: "/checkout/",
    value: pence,
    address: `203.0.113.${String(from)}`,
  });

  it("adds up what each event name measured", async () => {
    // Given an hour holding three purchases and two basket additions, each
    // carrying an amount in pence from a different reader.
    const deployed = await deployBeaconTable();
    await putDeliveredEvents(deployed, [
      purchase(2499, 1),
      purchase(1050, 2),
      purchase(399, 3),
      { ...purchase(1200, 4), event: "add-to-basket" },
      { ...purchase(800, 5), event: "add-to-basket" },
    ]);

    // When the question is asked of the day holding it.
    const rows = await answeredRows(deployed, totalsSql());

    // Then each name carries its own count and its own total, largest total
    // first. This is the question a shop asks, and before it the number was
    // in every row of the access log with nothing reading it.
    assertObjectEquals(rows, [
      ["purchase", "3", "3948"],
      ["add-to-basket", "2", "2000"],
    ]);
  });

  it("counts a row whose number cannot be read and leaves the total alone", async () => {
    // Given a purchase whose value arrived as text, which is what a site
    // sending an empty string or a formatted price produces.
    const deployed = await deployBeaconTable();
    await putDeliveredEvents(deployed, [
      purchase(2499, 1),
      { ...purchase(0, 2), value: undefined },
      { ...purchase(0, 3) },
    ]);

    // When the question is asked.
    const rows = await answeredRows(deployed, totalsSql());

    // Then the readable numbers add up and the row that carried none is
    // absent, since an event with no number is not what this counts. A zero
    // is a number and counts as one.
    assertObjectEquals(rows, [["purchase", "2", "2499"]]);
  });

  it("nets off a refund reported as a negative amount", async () => {
    // Given a purchase and a refund of part of it.
    const deployed = await deployBeaconTable();
    await putDeliveredEvents(deployed, [
      purchase(2499, 1),
      { ...purchase(-1000, 2), event: "refund" },
    ]);

    // Then the refund keeps its sign. `web-vitals` drops a negative because
    // a paint cannot happen before the navigation, and money can go both
    // ways, so this question keeps what that one throws out.
    assertObjectEquals(await answeredRows(deployed, totalsSql()), [
      ["purchase", "1", "2499"],
      ["refund", "1", "-1000"],
    ]);
  });

  it("leaves out the event names Rainlytics defines for itself", async () => {
    // Given an hour holding a site's own purchase beside a Web Vital, an
    // error and a route change.
    const deployed = await deployBeaconTable();
    await putDeliveredEvents(deployed, [
      purchase(2499, 1),
      {
        event: vitalEventNames.largestContentfulPaint,
        page: "/",
        value: 2400,
        address: "203.0.113.9",
      },
      {
        event: errorEventNames.uncaught,
        page: "/",
        message: "TypeError",
        address: "203.0.113.9",
      },
      { event: "route", page: "/liju/", address: "203.0.113.9" },
    ]);

    // Then only the site's own event is totalled. Milliseconds added
    // together mean nothing and would outrank the money, `web-vitals`
    // answers a paint properly, and neither an error nor a route change
    // carries a number at all.
    assertObjectEquals(await answeredRows(deployed, totalsSql()), [
      ["purchase", "1", "2499"],
    ]);
  });

  it("caps what one visitor contributes in an hour", async () => {
    // Given real purchases from five readers, and one client sending the
    // same event twice the cap over.
    const deployed = await deployBeaconTable();
    const readers = Array.from({ length: 5 }, (_unused, index) =>
      purchase(100, index),
    );
    const flooding = Array.from({ length: beaconTotalCap * 2 }, () => ({
      ...purchase(100, 200),
      address: "198.51.100.1",
    }));
    await putDeliveredEvents(deployed, [...readers, ...flooding]);

    // Then the readers count as five and the flood as the cap, so both the
    // count and the total stop where the cap does. Capping the count and
    // summing every row would report 65 events worth 12,500.
    assertObjectEquals(await answeredRows(deployed, totalsSql()), [
      [
        "purchase",
        String(5 + beaconTotalCap),
        String((5 + beaconTotalCap) * 100),
      ],
    ]);
  });

  it("lets a capped flood carry whatever number it chose", async () => {
    // Given a client sending an enormous amount over and over, which is the
    // limit of the cap rather than a hole in it.
    const deployed = await deployBeaconTable();
    const enormous = 999_999_999;
    await putDeliveredEvents(
      deployed,
      Array.from({ length: 1000 }, () => ({
        ...purchase(enormous, 0),
        address: "198.51.100.1",
      })),
    );

    // Then the cap holds the rows to sixty and the total is sixty times a
    // number nobody spent. The cap bounds rows, not the value a row carries,
    // and capping the value would clip a genuinely large purchase. The
    // rollup's description says so, because a total that reads as money is
    // the number a reader is least likely to question.
    assertObjectEquals(await answeredRows(deployed, totalsSql()), [
      ["purchase", String(beaconTotalCap), String(beaconTotalCap * enormous)],
    ]);
  });

  it("applies the cap to each hour, so the hours of a day add up to it", async () => {
    // Given one client flooding across two hours of the same day.
    const deployed = await deployBeaconTable();
    const nextHour = new Date(theBeaconHour.getTime() + 3_600_000);
    const flooding = (at: Date) =>
      Array.from({ length: beaconTotalCap * 2 }, () => ({
        ...purchase(100, 0),
        address: "198.51.100.1",
        at,
      }));
    await putDeliveredEvents(deployed, [
      ...flooding(theBeaconHour),
      ...flooding(nextHour),
    ]);

    // When the day holding both is totalled.
    const day = await answeredRows(deployed, totalsSql());

    // Then it holds two hours' worth of cap rather than one. The cap is
    // applied per hour of the row's own timestamp, which is what makes 24
    // hourly summaries add up to the daily one.
    assertObjectEquals(day, [
      [
        "purchase",
        String(beaconTotalCap * 2),
        String(beaconTotalCap * 2 * 100),
      ],
    ]);
  });

  it("adds its counts and its totals across stored windows", () => {
    // Given the rollup's declaration.
    // Then both columns add, and the total is what a ranked answer over
    // several windows is ordered by.
    assertObjectEquals(beaconTotals.totals, {
      added: ["total", "events"],
    });
  });

  it("says it identifies viewers", () => {
    // Given the cap, which names the viewer's address to key on.
    // Then the rollup declares it, so `RollupSummaries` refuses a deployment
    // whose delivery leaves the address out rather than failing once an hour
    // in a bucket nobody is watching.
    assertTrue(beaconTotals.identifiesViewers);
  });

  it("says what the cap does and does not bound", () => {
    // Given a reader of `rainlytics beacon-totals --help`.
    // Then the description says the cap holds rows rather than value. A
    // total that reads as money is the number a reader is least likely to
    // question, and the honest limit belongs beside it.
    assertStringIncludes(beaconTotals.description, "cap bounds rows and not");
  });

  it("is not one of the questions every deployment computes", () => {
    // Given the shipped list.
    // Then this is outside it. A site with no beacon would pay Athena's
    // minimum for an empty answer on both cadences.
    assertObjectEquals(
      rollups.filter((rollup) => rollup.name === beaconTotals.name),
      [],
    );
  });
});
