import {
  assertArrayLength,
  assertObjectEquals,
  assertStringIncludes,
  assertStringNotIncludes,
  assertThrowsError,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { answeredRows } from "#test/answered-rows.js";
import type { DeployedBeaconTable } from "#test/delivered-beacon-events.js";
import {
  deployBeaconTable,
  putDeliveredRecords,
  theBeaconDay,
  theBeaconHour,
} from "#test/delivered-beacon-events.js";

import { defaultBeaconPath } from "./beacon-events.js";
import { conversionsOfPath } from "./conversion-path-rollup.js";
import { pageviews } from "./rollup-questions.js";
import {
  currentMonth,
  rollupRequest,
  rollupSql,
  summarisedWindow,
  windowPlaceholder,
} from "./rollups.js";
import { unrenderedColumn, visitorCountSql } from "./visitor-counts.js";
import { saltedSql, visitorSaltPlaceholder } from "./visitor-identity.js";

describe("counting only visitors who rendered a page", () => {
  /** Where the rendered test begins in the SQL, being the pair's semi-join. */
  const theTest = "concat(c_ip, '|', cs_user_agent) IN (";

  /** What one visitor fetched in the window, beside the page itself. */
  interface Visit {
    /** The address they came from, which is half of who they are. */
    readonly address: string;

    /** The user agent, which is the other half. */
    readonly agent?: string;

    /** The paths they fetched after the page, with what each was answered. */
    readonly fetched?: readonly (readonly [path: string, status: string])[];

    /** When they fetched those, where it was not the seeded hour. */
    readonly fetchedAt?: Date;

    /** Where they posted after looking, as the shop's basket add. */
    readonly posted?: string;
  }

  /** The rows one visit leaves in the log. */
  const rowsOf = (visit: Visit): readonly Record<string, string>[] => {
    const common = {
      "timestamp(ms)": String(theBeaconHour.getTime()),
      "c-ip": visit.address,
      "cs(User-Agent)": visit.agent ?? "Mozilla/5.0%20(Macintosh)",
      "cs-uri-query": "-",
      "cs-method": "GET",
    };

    return [
      {
        ...common,
        "cs-uri-stem": "/cards/robin/",
        "sc-content-type": "text/html; charset=utf-8",
        "sc-status": "200",
      },
      ...(visit.fetched ?? []).map(([path, status]) => ({
        ...common,
        "timestamp(ms)": String((visit.fetchedAt ?? theBeaconHour).getTime()),
        "cs-uri-stem": path,
        "sc-content-type": "-",
        "sc-status": status,
      })),
      ...(visit.posted === undefined
        ? []
        : [
            {
              ...common,
              "cs-method": "POST",
              "cs-uri-stem": visit.posted,
              "sc-content-type": "-",
              "sc-status": "303",
            },
          ]),
    ];
  };

  /** These visits, delivered into the seeded hour. */
  const putVisits = async (
    deployed: DeployedBeaconTable,
    visits: readonly Visit[],
  ): Promise<void> => {
    await putDeliveredRecords(
      deployed,
      visits.flatMap((visit) => rowsOf(visit)),
    );
  };

  /** A visitor with an address nobody else in the case has. */
  const visitor = (did: Omit<Visit, "address"> = {}): Visit => ({
    address: faker.internet.ipv4(),
    ...did,
  });

  /** The hour the visits were seeded into, as a range. */
  const theHour = {
    from: theBeaconHour,
    to: new Date(theBeaconHour.getTime() + 3_600_000 - 1),
  };

  it("counts the views of visitors who fetched a stylesheet, a script or a font", async () => {
    // Given three people who loaded a card page and the files a browser
    // fetches to lay it out, one answered 304 from a revalidated cache, beside
    // one client that read the HTML and nothing else.
    const deployed = await deployBeaconTable();
    await putVisits(deployed, [
      visitor({ fetched: [["/wa/site.a1b2.css", "200"]] }),
      visitor({ fetched: [["/wa/app.c3d4.js", "304"]] }),
      visitor({ fetched: [["/fonts/body.woff2", "200"]] }),
      visitor(),
    ]);

    // When the pages are counted with and without the filter.
    const filtered = await answeredRows(
      deployed,
      rollupSql(
        pageviews,
        rollupRequest({ range: theBeaconDay, renderedOnly: true }),
      ),
    );
    const unfiltered = await answeredRows(
      deployed,
      rollupSql(pageviews, rollupRequest({ range: theBeaconDay })),
    );

    // Then the filter leaves out the client that rendered nothing. A 304 is
    // a browser asking whether its copy is current, which only a browser
    // laying out the page does.
    assertObjectEquals(filtered, [["/cards/robin/", "3"]]);
    assertObjectEquals(unfiltered, [["/cards/robin/", "4"]]);
  });

  it("counts a visitor whose only sign of rendering is the beacon", async () => {
    // Given a returning browser that took every asset from its cache without
    // asking, and sent a beacon event from the page.
    const deployed = await deployBeaconTable();
    await putVisits(deployed, [
      visitor({ fetched: [[defaultBeaconPath, "204"]] }),
    ]);

    // When the pages are counted with the filter.
    const rows = await answeredRows(
      deployed,
      rollupSql(
        pageviews,
        rollupRequest({ range: theBeaconDay, renderedOnly: true }),
      ),
    );

    // Then they are counted. The beacon runs in the page, so a request to its
    // path is a page that rendered whatever the cache did.
    assertObjectEquals(rows, [["/cards/robin/", "1"]]);
  });

  it("looks for the beacon where a site moved it", async () => {
    // Given a returning browser whose assets all came from its cache, on a
    // site whose BeaconPath reports to /telemetry.
    const deployed = await deployBeaconTable();
    await putVisits(deployed, [visitor({ fetched: [["/telemetry", "204"]] })]);

    // When the pages are counted looking for the default path, and for the
    // site's own.
    const atDefault = await answeredRows(
      deployed,
      rollupSql(
        pageviews,
        rollupRequest({ range: theBeaconDay, renderedOnly: true }),
      ),
    );
    const atTelemetry = await answeredRows(
      deployed,
      rollupSql(
        pageviews,
        rollupRequest({
          range: theBeaconDay,
          renderedOnly: { beaconPath: "/telemetry" },
        }),
      ),
    );

    // Then only the second counts them. A beacon the filter is not looking
    // for leaves its sender judged on the cache alone.
    assertObjectEquals(atDefault, []);
    assertObjectEquals(atTelemetry, [["/cards/robin/", "1"]]);
  });

  it("refuses a beacon path that does not start with a slash", () => {
    // Given a beacon path written without its leading slash, or empty. An
    // empty one would match every request and mark every visitor rendered.
    for (const beaconPath of ["", "telemetry"]) {
      const writing = (): string =>
        rollupSql(
          pageviews,
          rollupRequest({ range: theBeaconDay, renderedOnly: { beaconPath } }),
        );

      // Then the SQL is not written.
      assertStringIncludes(assertThrowsError(writing).message, "starting with");
    }
  });

  it("leaves out a visitor who fetched only an image", async () => {
    // Given a link preview fetching a page and the image its metadata names.
    const deployed = await deployBeaconTable();
    await putVisits(deployed, [
      visitor({ fetched: [["/images/robin.webp", "200"]] }),
    ]);

    // When the pages are counted with the filter.
    const rows = await answeredRows(
      deployed,
      rollupSql(
        pageviews,
        rollupRequest({ range: theBeaconDay, renderedOnly: true }),
      ),
    );

    // Then nothing is counted. An image is what a preview fetcher most often
    // wants, so it says nothing about a page being laid out.
    assertObjectEquals(rows, []);
  });

  it("judges the address and the user agent together", async () => {
    // Given one address where a browser fetched a stylesheet and a script
    // with another user agent fetched the page alone. A household behind one
    // address is the ordinary case of this.
    const deployed = await deployBeaconTable();
    const address = faker.internet.ipv4();
    await putVisits(deployed, [
      { address, fetched: [["/wa/site.css", "200"]] },
      { address, agent: "python-requests/2.32" },
    ]);

    // When the pages are counted with the filter.
    const rows = await answeredRows(
      deployed,
      rollupSql(
        pageviews,
        rollupRequest({ range: theBeaconDay, renderedOnly: true }),
      ),
    );

    // Then the browser's view counts and the other one does not. Judging the
    // address alone would let any client sharing one with a person through.
    assertObjectEquals(rows, [["/cards/robin/", "1"]]);
  });

  it("looks for the rendering inside the window being counted", async () => {
    // Given a visitor whose page fell in one hour and whose stylesheet
    // request fell in the next.
    const deployed = await deployBeaconTable();
    const nextHour = new Date(theBeaconHour.getTime() + 3_600_000 + 60_000);
    await putVisits(deployed, [
      visitor({ fetched: [["/wa/site.css", "200"]], fetchedAt: nextHour }),
    ]);

    // When the first hour's pages are counted with the filter, and the day's.
    const hour = await answeredRows(
      deployed,
      rollupSql(
        pageviews,
        rollupRequest({ range: theHour, renderedOnly: true }),
      ),
    );
    const day = await answeredRows(
      deployed,
      rollupSql(
        pageviews,
        rollupRequest({ range: theBeaconDay, renderedOnly: true }),
      ),
    );

    // Then the hour leaves the view out and the day counts it. The test reads
    // the span the question reads, so a visit crossing a window boundary is
    // judged on the half inside it.
    assertObjectEquals(hour, []);
    assertObjectEquals(day, [["/cards/robin/", "1"]]);
  });

  it("counts the visitors it dropped beside the ones it kept", async () => {
    // Given two people who rendered the page and three clients that did not.
    const deployed = await deployBeaconTable();
    await putVisits(deployed, [
      visitor({ fetched: [["/wa/site.css", "200"]] }),
      visitor({ fetched: [["/wa/app.js", "304"]] }),
      visitor(),
      visitor(),
      visitor(),
    ]);

    // When the visitors are counted with the filter.
    const sql = visitorCountSql(
      rollupRequest({ range: theBeaconDay, renderedOnly: true }),
    );
    const rows = await answeredRows(deployed, saltedSql(sql, "a-salt"));

    // Then the count is the two, and the three left out are counted beside
    // them. A site that sees the second number climb can tell the filter has
    // begun dropping its customers.
    assertObjectEquals(rows, [["2", "3"]]);
  });

  it("writes no second column where the filter is off", () => {
    // Given a visitor count asked without the filter.
    const sql = visitorCountSql(rollupRequest({ range: theBeaconDay }));

    // Then the answer is the one column every reader already parses.
    assertStringNotIncludes(sql, unrenderedColumn);
    assertStringNotIncludes(sql, theTest);
  });

  it("drops the bots from both halves of a conversion rate", async () => {
    // Given the shape measured on one shop in November 2026. Two people
    // loaded a card page and its assets, and one checked out. Two scripts
    // fetched the page and posted to the basket without loading anything.
    const deployed = await deployBeaconTable();
    await putVisits(deployed, [
      visitor({
        fetched: [["/wa/site.css", "200"]],
        posted: "/do/basket/add",
      }),
      visitor({ fetched: [["/wa/site.css", "200"]] }),
      visitor({ posted: "/do/basket/add" }),
      visitor({ posted: "/do/basket/add" }),
    ]);
    const adding = conversionsOfPath({
      path: "/do/basket/add",
      method: "POST",
      statuses: ["303"],
    });

    // When the basket-add rate is asked with and without the filter.
    const filtered = await answeredRows(
      deployed,
      rollupSql(
        adding,
        rollupRequest({ range: theBeaconDay, renderedOnly: true }),
      ),
    );
    const unfiltered = await answeredRows(
      deployed,
      rollupSql(adding, rollupRequest({ range: theBeaconDay })),
    );

    // Then the filtered rate is one of two people rather than three of four
    // visitors. The scripts inflated the adds and the denominator together,
    // which is what made a later step of the funnel look broken.
    assertObjectEquals(filtered, [["1", "2", "50.0"]]);
    assertObjectEquals(unfiltered, [["3", "4", "75.0"]]);
  });

  it("reads the same window in the test as in the question", () => {
    // Given questions over a scheduled window and over the current month.
    const scheduled = rollupSql(
      pageviews,
      rollupRequest({ range: summarisedWindow, renderedOnly: true }),
    );
    const saved = rollupSql(
      pageviews,
      rollupRequest({ range: currentMonth, renderedOnly: true }),
    );

    // Then the subquery carries the same partition conditions as the query
    // around it, so filling the window in once fills both. A subquery left
    // reading every partition would scan the whole store once an hour.
    assertArrayLength(scheduled.split(windowPlaceholder), 3);
    assertArrayLength(
      saved.split("month = date_format(current_date, '%m')"),
      3,
    );
  });

  it("carries the salt placeholder once per digest it takes", () => {
    // Given the visitor count a schedule carries for a filtered question.
    const sql = visitorCountSql(
      rollupRequest({ range: summarisedWindow, renderedOnly: true }),
    );

    // Then it carries the placeholder the job fills in, and the rendered
    // test once rather than in each of the two columns.
    assertStringIncludes(sql, visitorSaltPlaceholder);
    assertArrayLength(sql.split(theTest), 2);
  });
});
