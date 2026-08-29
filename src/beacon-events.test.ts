import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import {
  aBeaconEvent,
  beaconEventColumn,
  beaconParameters,
  beaconQueryString,
  beaconSchemaVersion,
  defaultBeaconPath,
} from "./beacon-events.js";

describe("the beacon event envelope", () => {
  it("stamps every event with the version it was written under", () => {
    // Given an event the beacon is about to send.
    const sent = beaconQueryString({
      event: "route",
      page: "/guides/",
    });

    // Then the version rides with it. The raw store keeps whatever was
    // written into it, so a row has to say which shape it is rather than
    // leave a reader to infer one from the date.
    expect(sent).toContain(
      `${beaconParameters.version}=${String(beaconSchemaVersion)}`,
    );
  });

  it("carries the page the event happened on, since the path cannot", () => {
    // Given a route change on a page whose address the request never names.
    // Every beacon request goes to the same path, so the path in the log says
    // where the beacon is and never where the reader was.
    const page = `/${faker.word.noun()}/`;

    // When it is sent.
    const sent = beaconQueryString({ event: "route", page });

    // Then the page travels in the payload.
    expect(sent).toContain(
      `${beaconParameters.page}=${encodeURIComponent(page)}`,
    );
  });

  it("encodes a value that would otherwise end the query string", () => {
    // Given a page whose address holds the characters that separate one
    // parameter from the next, which a router with a catch-all route can
    // produce.
    const sent = beaconQueryString({
      event: "route",
      page: "/search/?q=a&b=c",
    });

    // Then they arrive as text rather than as three more parameters. Read
    // back, the page is the address the reader was on.
    expect(sent).toContain("%3Fq%3Da%26b%3Dc");
    expect(sent.split("&")).toHaveLength(3);
  });

  it("reads a row's event back off the column CloudFront wrote it to", () => {
    // Given the SQL a rollup selects the event with.
    // Then it reads the query string, which is where the payload is. No
    // column of the table holds it, because a table column is a CloudFront
    // field and CloudFront has no field for somebody else's payload.
    expect(beaconEventColumn).toContain("cs_uri_query");
    expect(beaconEventColumn).toContain(`'${beaconParameters.event}'`);
  });

  it("counts only requests carrying an envelope", () => {
    // Given the conditions a rollup filters beacon rows with.
    // Then a request to the beacon's path with no version parameter is left
    // out. A crawler that found the URL in a page's source sends one of
    // those, and counting it would report an event nobody caused.
    expect(aBeaconEvent).toContain("cs_uri_query <> '-'");
    expect(aBeaconEvent.join(" ")).toContain(`'${beaconParameters.version}'`);
  });

  it("sends to a path a site is unlikely to serve already", () => {
    // Given the default path.
    // Then it is one path, absolute, and marked as not a page. Pointing the
    // beacon at a published page would count every event as a view of it and
    // download that page a second time.
    expect(defaultBeaconPath).toMatch(/^\/_/u);
  });
});
