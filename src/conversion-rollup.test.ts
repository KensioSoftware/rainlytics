import {
  assertObjectEquals,
  assertStringMatches,
  assertThrowsError,
  assertTrue,
  assertUndefined,
} from "@kensio/smartass";

import { describe, it } from "vitest";

import { answeredRows } from "#test/answered-rows.js";
import type { DeployedBeaconTable } from "#test/delivered-beacon-events.js";
import {
  asCloudFrontWrites,
  deployBeaconTable,
  putDeliveredRecords,
  theBeaconDay,
  theBeaconHour,
} from "#test/delivered-beacon-events.js";

import { beaconQueryString, defaultBeaconPath } from "./beacon-events.js";
import { conversionsOf } from "./conversion-rollup.js";
import { rollupRequest, rollupSql } from "./rollups.js";

describe("counting how many visitors converted", () => {
  /** What one visitor did in the window. */
  interface Visited {
    /** The address they came from, which is half of who they are. */
    readonly address: string;

    /** Whether they looked at a page. */
    readonly viewed?: boolean;

    /** The event they raised, where they raised one. */
    readonly raised?: string | undefined;

    /** The path the beacon reported to. */
    readonly beaconPath?: string;
  }

  /** The rows one visitor's visit produces in the log. */
  const rowsFor = (visit: Visited): readonly Record<string, string>[] => {
    const common = {
      "timestamp(ms)": String(theBeaconHour.getTime()),
      "cs-method": "GET",
      "cs(User-Agent)": "Mozilla/5.0",
      "c-ip": visit.address,
    };
    const rows: Record<string, string>[] = [];

    if (visit.viewed !== false) {
      rows.push({
        ...common,
        "cs-uri-stem": "/shop/",
        "sc-content-type": "text/html; charset=utf-8",
        "sc-status": "200",
        "cs-uri-query": "-",
      });
    }

    if (visit.raised !== undefined) {
      rows.push({
        ...common,
        "cs-uri-stem": visit.beaconPath ?? defaultBeaconPath,
        "sc-content-type": "-",
        "sc-status": "204",
        "cs-uri-query": asCloudFrontWrites(
          beaconQueryString([{ event: visit.raised, page: "/shop/" }]),
        ),
      });
    }

    return rows;
  };

  /** These visits, delivered into the bucket the way CloudFront delivers. */
  const putDelivered = async (
    deployed: DeployedBeaconTable,
    visits: readonly Visited[],
  ): Promise<void> => {
    await putDeliveredRecords(
      deployed,
      visits.flatMap((visit) => rowsFor(visit)),
    );
  };

  /** The question's own SQL, over the day holding the seeded hour. */
  const conversionSql = (event = "purchase", over = {}): string =>
    rollupSql(
      conversionsOf(event),
      rollupRequest({ range: theBeaconDay, ...over }),
    );

  /** One visitor, numbered, who looked at a page. */
  const visitor = (index: number, raised?: string): Visited => ({
    address: `203.0.113.${String(index)}`,
    ...(raised === undefined ? {} : { raised }),
  });

  it("counts the visitors who raised the event against all of them", async () => {
    // Given ten people who looked at the shop, two of whom bought.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, "purchase"),
      visitor(2, "purchase"),
      ...Array.from({ length: 8 }, (_unused, index) => visitor(index + 3)),
    ]);

    // When the question is asked of the day.
    const rows = await answeredRows(deployed, conversionSql());

    // Then it answers two out of ten. This is the first question a shop asks
    // and every ingredient was already in the table: a pageview and a
    // purchase were two rows with no join drawn between them.
    assertObjectEquals(rows, [["2", "10", "20.0"]]);
  });

  it("counts one visitor once however often they raised it", async () => {
    // Given one reader who bought three times in the window, beside one who
    // only looked.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, "purchase"),
      visitor(1, "purchase"),
      visitor(1, "purchase"),
      visitor(2),
    ]);

    // Then the answer is one visitor out of two. A conversion rate counts
    // people rather than events, which is what separates this question from
    // `beacon-events`.
    assertObjectEquals(await answeredRows(deployed, conversionSql()), [
      ["1", "2", "50.0"],
    ]);
  });

  it("leaves out somebody who converted without looking at a page", async () => {
    // Given a reader who arrived with the page already open from an earlier
    // window and bought inside this one.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      { address: "203.0.113.1", viewed: false, raised: "purchase" },
      visitor(2),
    ]);

    // Then they are in neither column, so the proportion stays at or below
    // one. A numerator counting them against a denominator that cannot see
    // them is how a conversion rate comes back above 100%.
    assertObjectEquals(await answeredRows(deployed, conversionSql()), [
      ["0", "1", "0.0"],
    ]);
  });

  it("counts only the event it was built for", async () => {
    // Given a reader who signed up and one who bought.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, "signup"),
      visitor(2, "purchase"),
    ]);

    // Then a question about purchases sees one of the two, and a question
    // about signups sees the other. Two questions, two names, two summaries.
    assertObjectEquals(
      await answeredRows(deployed, conversionSql("purchase")),
      [["1", "2", "50.0"]],
    );
    assertObjectEquals(await answeredRows(deployed, conversionSql("signup")), [
      ["1", "2", "50.0"],
    ]);
  });

  it("counts a conversion reported to a beacon path a site chose", async () => {
    // Given a site whose beacon reports somewhere other than the default.
    const ownPath = "/_metrics";
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      { ...visitor(1, "purchase"), beaconPath: ownPath },
      visitor(2),
    ]);

    // Then `--path` names it, the way it does for every other question over
    // beacon rows, and the visitors counted stay site-wide.
    assertObjectEquals(
      await answeredRows(
        deployed,
        conversionSql("purchase", { paths: [ownPath] }),
      ),
      [["1", "2", "50.0"]],
    );
  });

  it("counts nothing on the beacon path as a page that was looked at", async () => {
    // Given a reader who did nothing but raise the event, on the default
    // path, with no page request of their own.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      { address: "203.0.113.1", viewed: false, raised: "purchase" },
    ]);

    // Then the window saw no visitors at all. A beacon request is a request,
    // and counting it as a pageview would put the reader in the denominator
    // twice over and inflate a quiet window.
    assertObjectEquals(await answeredRows(deployed, conversionSql()), [
      ["0", "0", ""],
    ]);
  });

  it("answers from one stored window rather than adding two", () => {
    // Given the question's declaration.
    // Then it names no totals. A distinct count belongs to the window it was
    // taken over: two hours of ten visitors each are not twenty people, and
    // a command asked about a longer span says so instead of adding them.
    assertUndefined(conversionsOf("purchase").totals);
  });

  it("says it identifies viewers", () => {
    // Given the join, which is drawn on the viewer's address and user agent.
    // Then the question declares it, so `RollupSummaries` refuses a
    // deployment whose delivery leaves the address out rather than answering
    // every visitor as one.
    assertTrue(conversionsOf("purchase").identifiesViewers);
  });

  it("takes a name of its own for each event it counts", () => {
    // Given two events a site converts on.
    // Then each question is named for its own, so the two get two saved
    // queries, two schedules and two summary keys.
    assertObjectEquals(
      [conversionsOf("purchase").name, conversionsOf("signup").name],
      ["conversions-purchase", "conversions-signup"],
    );
  });

  it("refuses an event name that would not survive a subcommand", () => {
    // Given an event name with a space in it.
    // Then it is refused where somebody is looking, rather than at deploy
    // time under a mangled CDK logical id.
    const error = assertThrowsError(() => conversionsOf("Add To Basket"));

    assertStringMatches(error.message, /conversions-Add To Basket/u);
  });
});
