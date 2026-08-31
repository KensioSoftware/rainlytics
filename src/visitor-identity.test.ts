import {
  assertArrayLength,
  assertIdentical,
  assertSetSize,
  assertStringIncludes,
  assertStringMatches,
  assertStringNotIncludes,
  assertThrowsError,
  assertTrue,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { reportPeriod } from "./report-periods.js";
import type { SummaryWindow } from "./summary-windows.js";
import {
  reportVisitorSaltMessage,
  saltedSql,
  visitorIdentifier,
  visitorSaltDay,
  visitorSaltMessage,
  visitorSaltPlaceholder,
  visitorText,
} from "./visitor-identity.js";

describe("the period a report visitor count is scoped to", () => {
  it("records the calendar and first weekday in a weekly salt message", () => {
    // Given one closed London week beginning on Monday.
    const period = reportPeriod(
      {
        unit: "week",
        at: new Date("2026-08-26T12:00:00.000Z"),
        timeZone: "Europe/London",
        weekStartsOn: "monday",
      },
      new Date("2026-08-31T23:00:00.000Z"),
    );

    // Then another calendar or week convention derives another salt.
    const message = reportVisitorSaltMessage(period);
    assertStringIncludes(message, "Europe%2FLondon");
    assertStringIncludes(message, "/week/");
    assertStringIncludes(message, "/monday/");
    assertStringIncludes(message, period.startsOn);
    assertStringIncludes(message, period.endsBefore);
  });
});

describe("the day a window is counted under", () => {
  it("is the UTC day the window opens in", () => {
    // Given an hour late on a day in August.
    const window: SummaryWindow = {
      granularity: "hourly",
      at: new Date("2026-08-23T23:41:07.512Z"),
    };

    // Then the day is that day, whatever the clock said when the run
    // happened.
    assertIdentical(visitorSaltDay(window), "2026-08-23");
  });

  it("is the same for every hour of one day", () => {
    // Given every hour of a day.
    const hours = Array.from({ length: 24 }, (_unused, hour) => ({
      granularity: "hourly" as const,
      at: new Date(Date.UTC(2026, 7, 23, hour, 30)),
    }));

    const day = visitorSaltDay({
      granularity: "daily",
      at: new Date("2026-08-23T12:00:00.000Z"),
    });
    const counted = new Set(hours.map((hour) => visitorSaltDay(hour)));

    // Then all of them count under the day that holds them, and so does the
    // daily window over the top. The 24 hourly summaries and the daily one
    // are counting the same identifiers.
    assertSetSize(counted, 1);
    assertTrue(counted.has(day));
  });

  it("names the scheme in the message it is derived over", () => {
    // Given the day a window falls in.
    const day = "2026-08-23";

    // Then the message carries the day and says which scheme built it. A
    // change to how an identifier is built takes the number with it, and
    // every past day then derives the salt it was counted under.
    assertStringIncludes(visitorSaltMessage(day), day);
    assertStringMatches(visitorSaltMessage(day), /visitor-salt\/1\//u);
  });
});

describe("what a record hashes to", () => {
  it("carries the address, the user agent and the salt", () => {
    // Then all three reach the text a digest is taken over. The address says
    // two requests came from one place, the user agent separates the people
    // behind one of them, and the salt is what keeps the digest to a day.
    assertStringIncludes(visitorText, "c_ip");
    assertStringIncludes(visitorText, "cs_user_agent");
    assertStringIncludes(visitorText, visitorSaltPlaceholder);
  });

  it("is a hex digest of that text", () => {
    // Then the identifier is a SHA-256 over it. Nothing stores one, and a
    // count of the distinct digests of a window is the whole of what leaves
    // Athena.
    assertIdentical(
      visitorIdentifier,
      `to_hex(sha256(to_utf8(${visitorText})))`,
    );
  });
});

describe("filling a day's salt into a query", () => {
  const aSalt = (): string =>
    faker.string.hexadecimal({ length: 64, prefix: "" });

  it("writes it wherever the placeholder stood", () => {
    // Given a query carrying the placeholder twice.
    const salt = aSalt();
    const template = `SELECT ${visitorText}, ${visitorText}`;

    // When the day's salt is filled in.
    const sql = saltedSql(template, salt);

    // Then both are the salt as a quoted literal, and none of the
    // placeholder is left.
    assertStringNotIncludes(sql, visitorSaltPlaceholder);
    assertArrayLength(sql.split(`'${salt}'`), 3);
  });

  it("quotes a salt holding a quote", () => {
    // Given a secret somebody put an apostrophe in.
    const template = `SELECT ${visitorText}`;

    // When it is filled in.
    const sql = saltedSql(template, "it's a salt");

    // Then the quote is doubled and the literal still closes where it should.
    assertStringIncludes(sql, "'it''s a salt'");
  });

  it("refuses a query with nowhere to put it", () => {
    // Given a query that says nothing about which day it counts under. It is
    // either not a visitor count, or one whose salt has already gone in.
    const filling = (): string => saltedSql("SELECT count(*)", aSalt());

    // Then it is refused. Filling a second window's query with the first
    // one's salt would count two days as one.
    {
      const error = assertThrowsError(filling);
      assertStringMatches(error.message, /which day's salt/u);
    }
  });
});
