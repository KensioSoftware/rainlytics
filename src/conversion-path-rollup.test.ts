import {
  assertIdentical,
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
  deployBeaconTable,
  putDeliveredRecords,
  theBeaconDay,
  theBeaconHour,
} from "#test/delivered-beacon-events.js";

import type { ConvertingRequest } from "./conversion-path-rollup.js";
import { conversionsOfPath } from "./conversion-path-rollup.js";
import { rollupRequest, rollupSql } from "./rollups.js";

describe("counting how many visitors converted on a path", () => {
  /** What one visitor did in the window, as a server-rendered shop sees it. */
  interface Visited {
    /** The address they came from, which is half of who they are. */
    readonly address: string;

    /** Whether they looked at a page. */
    readonly viewed?: boolean;

    /** The path they posted to, where they posted to one. */
    readonly posted?: string | undefined;

    /** What the site answered that post with. */
    readonly answered?: string;

    /** The method they used, where it was not a post. */
    readonly method?: string;

    /** What came back, where the site answered a page rather than a redirect. */
    readonly contentType?: string;

    /** The user agent, which is the other half of who they are. */
    readonly agent?: string;
  }

  /** The rows one visitor's visit produces in the log. */
  const rowsFor = (visit: Visited): readonly Record<string, string>[] => {
    const common = {
      "timestamp(ms)": String(theBeaconHour.getTime()),
      "cs(User-Agent)": visit.agent ?? "Mozilla/5.0",
      "c-ip": visit.address,
      "cs-uri-query": "-",
    };
    const rows: Record<string, string>[] = [];

    if (visit.viewed !== false) {
      rows.push({
        ...common,
        "cs-method": "GET",
        "cs-uri-stem": "/shop/",
        "sc-content-type": "text/html; charset=utf-8",
        "sc-status": "200",
      });
    }

    if (visit.posted !== undefined) {
      rows.push({
        ...common,
        "cs-method": visit.method ?? "POST",
        "cs-uri-stem": visit.posted,
        "sc-content-type": visit.contentType ?? "-",
        "sc-status": visit.answered ?? "303",
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

  /** The checkout as this shop's own requests describe it. */
  const theCheckout: ConvertingRequest = {
    path: "/do/checkout",
    method: "POST",
    statuses: ["303"],
  };

  /** The question's own SQL, over the day holding the seeded hour. */
  const conversionSql = (
    converting: ConvertingRequest = theCheckout,
    over = {},
  ): string =>
    rollupSql(
      conversionsOfPath(converting),
      rollupRequest({ range: theBeaconDay, ...over }),
    );

  /** One visitor, numbered, who looked at a page. */
  const visitor = (index: number, did?: Partial<Visited>): Visited => ({
    address: `203.0.113.${String(index)}`,
    ...did,
  });

  it("counts the visitors who reached the path against all of them", async () => {
    // Given ten people who looked at a shop with no beacon anywhere in it,
    // two of whom checked out.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, { posted: "/do/checkout" }),
      visitor(2, { posted: "/do/checkout" }),
      ...Array.from({ length: 8 }, (_unused, index) => visitor(index + 3)),
    ]);

    // When the question is asked of the day.
    const rows = await answeredRows(deployed, conversionSql());

    // Then it answers two out of ten, off rows CloudFront had already
    // written. A site with no JavaScript was the case Rainlytics exists for
    // and the conversion rate was the one question it could not answer.
    assertObjectEquals(rows, [["2", "10", "20.0"]]);
  });

  it("counts one visitor once however often they converted", async () => {
    // Given one reader who checked out three times in the window, beside one
    // who only looked.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, { posted: "/do/checkout" }),
      visitor(1, { posted: "/do/checkout" }),
      visitor(1, { posted: "/do/checkout" }),
      visitor(2),
    ]);

    // Then the answer is one visitor out of two. A conversion rate counts
    // people, and the request-counting version of this question answers
    // something weaker.
    assertObjectEquals(await answeredRows(deployed, conversionSql()), [
      ["1", "2", "50.0"],
    ]);
  });

  it("leaves out a request the site refused", async () => {
    // Given a checkout that came back 400 beside one that came back 303.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, { posted: "/do/checkout", answered: "400" }),
      visitor(2, { posted: "/do/checkout" }),
    ]);

    // Then only the second visitor converted. Somebody whose card was
    // declined tried, and a question counting them reports a rate the shop
    // never had.
    assertObjectEquals(await answeredRows(deployed, conversionSql()), [
      ["1", "2", "50.0"],
    ]);
  });

  it("leaves out a request made with another method", async () => {
    // Given somebody who loaded the checkout page and somebody who posted to
    // it, which are two things about one path.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, { posted: "/do/checkout", method: "GET", answered: "200" }),
      visitor(2, { posted: "/do/checkout" }),
    ]);

    // Then the post is the conversion and the page load is not.
    assertObjectEquals(await answeredRows(deployed, conversionSql()), [
      ["1", "2", "50.0"],
    ]);
  });

  it("counts every method and status where the request names neither", async () => {
    // Given a site whose order page is an ordinary HTML GET, described by
    // its path alone. The row is a page view as well as a conversion, which
    // is the shape of every site that converts on a thank-you page.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, {
        posted: "/order/done/",
        method: "GET",
        answered: "200",
        contentType: "text/html; charset=utf-8",
      }),
      visitor(2),
    ]);

    // Then reaching the path is the whole of the conversion, and the visitor
    // is counted once in each column rather than twice in the denominator.
    assertObjectEquals(
      await answeredRows(deployed, conversionSql({ path: "/order/done/" })),
      [["1", "2", "50.0"]],
    );
  });

  it("leaves out somebody who converted without looking at a page", async () => {
    // Given a reader who arrived with the basket already open from an earlier
    // window and checked out inside this one.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      { address: "203.0.113.1", viewed: false, posted: "/do/checkout" },
      visitor(2),
    ]);

    // Then they are in neither column, so the proportion stays at or below
    // one. A numerator counting them against a denominator that cannot see
    // them is how a conversion rate comes back above 100%.
    assertObjectEquals(await answeredRows(deployed, conversionSql()), [
      ["0", "1", "0.0"],
    ]);
  });

  it("matches the path as a prefix", async () => {
    // Given a checkout that carries the order beneath it in the path.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, { posted: "/do/checkout/1a2b" }),
      visitor(2),
    ]);

    // Then it matches, the way `--path` matches a section of a site. One
    // definition of a prefix covers the filter and this question's numerator.
    assertObjectEquals(await answeredRows(deployed, conversionSql()), [
      ["1", "2", "50.0"],
    ]);
  });

  /** A phone, as CloudFront writes Safari on an iPhone. */
  const aPhone =
    "Mozilla/5.0%20(iPhone;%20CPU%20iPhone%20OS%2018_6%20like%20Mac%20OS%20X)" +
    "%20AppleWebKit/605.1.15%20(KHTML,%20like%20Gecko)%20Version/18.6" +
    "%20Mobile/15E148%20Safari/604.1";

  /** A desktop, as CloudFront writes Chrome on Windows. */
  const aDesktop =
    "Mozilla/5.0%20(Windows%20NT%2010.0;%20Win64;%20x64)" +
    "%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko)" +
    "%20Chrome/141.0.0.0%20Safari/537.36";

  /** An Android tablet, which carries no `Mobile` token. */
  const aTablet =
    "Mozilla/5.0%20(Linux;%20Android%2015;%20SM-X710)" +
    "%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko)" +
    "%20Chrome/141.0.0.0%20Safari/537.36";

  it("splits the visitors by device class where asked", async () => {
    // Given two people on phones, one of whom checked out, one person at a
    // desktop who checked out, and one on a tablet who only looked.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, { agent: aPhone, posted: "/do/checkout" }),
      visitor(2, { agent: aPhone }),
      visitor(3, { agent: aDesktop, posted: "/do/checkout" }),
      visitor(4, { agent: aTablet }),
    ]);

    // When the question split by device is asked of the day.
    const rows = await answeredRows(
      deployed,
      conversionSql({ ...theCheckout, byDevice: true }),
    );

    // Then each class answers for its own visitors, read off the same ladder
    // `browsers` uses, and the rows add up to the two out of four the
    // question without the split would give.
    assertObjectEquals(rows, [
      ["Desktop", "1", "1", "100.0"],
      ["Mobile", "1", "2", "50.0"],
      ["Tablet", "0", "1", "0.0"],
    ]);
  });

  it("counts one address on two devices as two visitors", async () => {
    // Given one household address, browsing from a phone and checking out
    // from a desktop.
    const deployed = await deployBeaconTable();
    await putDelivered(deployed, [
      visitor(1, { agent: aPhone }),
      visitor(1, { agent: aDesktop, posted: "/do/checkout" }),
    ]);

    // Then each device is a visitor of its own, which is what a visitor
    // already was. The split adds a column and divides nobody.
    assertObjectEquals(
      await answeredRows(
        deployed,
        conversionSql({ ...theCheckout, byDevice: true }),
      ),
      [
        ["Desktop", "1", "1", "100.0"],
        ["Mobile", "0", "1", "0.0"],
      ],
    );
  });

  it("names the split question apart from the whole one", () => {
    // Given one path asked about both ways.
    const whole = conversionsOfPath(theCheckout);
    const split = conversionsOfPath({ ...theCheckout, byDevice: true });

    // Then the two get two names, so a site can deploy both and keep two
    // summaries, and the split one still declares no totals and still says
    // it identifies viewers.
    assertObjectEquals(
      [whole.name, split.name, split.totals, split.identifiesViewers],
      [
        "conversions-do-checkout",
        "conversions-do-checkout-by-device",
        undefined,
        true,
      ],
    );
    assertStringMatches(split.description, /Tablet, Mobile, Desktop or Other/u);
  });

  it("answers from one stored window rather than adding two", () => {
    // Given the question's declaration.
    // Then it names no totals, for the reason `conversionsOf` names none. A
    // distinct count belongs to the window it was taken over.
    assertUndefined(conversionsOfPath(theCheckout).totals);
  });

  it("says it identifies viewers", () => {
    // Given the join, which is drawn on the viewer's address and user agent.
    // Then the question declares it, so `RollupSummaries` refuses a
    // deployment whose delivery leaves the address out rather than answering
    // every visitor as one.
    assertTrue(conversionsOfPath(theCheckout).identifiesViewers);
  });

  it("takes its name from the path", () => {
    // Given two paths a shop converts on.
    // Then each question is named for its own, so the two get two saved
    // queries, two schedules and two summary keys.
    assertObjectEquals(
      [
        conversionsOfPath({ path: "/do/checkout" }).name,
        conversionsOfPath({ path: "/do/signup/" }).name,
      ],
      ["conversions-do-checkout", "conversions-do-signup"],
    );
  });

  it("takes a name it was given over the one the path makes", () => {
    // Given two paths whose segments reduce to the same words.
    // Then a name of its own tells them apart.
    assertIdentical(
      conversionsOfPath({ path: "/do/check-out", name: "checkout" }).name,
      "conversions-checkout",
    );
  });

  it("refuses a path that makes no name at all", () => {
    // Given the site root, which reduces to nothing.
    // Then it says so where somebody is looking, and says which prop is the
    // way past it, rather than failing at deploy time under a mangled CDK
    // logical id.
    const error = assertThrowsError(() => conversionsOfPath({ path: "/" }));

    assertStringMatches(error.message, /"name"/u);
  });

  it("refuses a name that would not survive a subcommand", () => {
    // Given a name with a space in it.
    const error = assertThrowsError(() =>
      conversionsOfPath({ path: "/do/checkout", name: "Check Out" }),
    );

    assertStringMatches(error.message, /conversions-Check Out/u);
  });
});
