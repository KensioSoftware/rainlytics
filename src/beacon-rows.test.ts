import {
  assertArrayIncludes,
  assertStringIncludes,
  assertStringNotIncludes,
} from "@kensio/smartass";
import { describe, it } from "vitest";

import { beaconParameters, defaultBeaconPath } from "./beacon-events.js";
import {
  aBeaconEvent,
  beaconEventColumn,
  beaconEventsAlias,
  beaconEventsJoin,
  outsideTheBeaconPath,
} from "./beacon-rows.js";

describe("reading a beacon event off a row", () => {
  it("reads a row's events back off the column CloudFront wrote them to", () => {
    // Given the SQL a rollup unnests a row's events with.
    // Then it reads the query string, which is where the payload is. No
    // column of the table holds it, because a table column is a CloudFront
    // field and CloudFront has no field for somebody else's payload.
    assertStringIncludes(beaconEventsJoin(), "cs_uri_query");

    // And it reads both shapes, since the raw store still holds every
    // version 1 row ever written and keeps answering questions about them.
    assertStringIncludes(beaconEventsJoin(), `'${beaconParameters.events}'`);
    assertStringIncludes(beaconEventsJoin(), `'${beaconParameters.event}'`);
  });

  it("selects one event's field out of what the row unnested to", () => {
    // Given the SQL a rollup selects the event name with.
    // Then it reads a position out of the packed event rather than the row,
    // so a request that carried four events answers four times.
    assertStringIncludes(beaconEventColumn, beaconEventsAlias);
  });

  it("counts only requests carrying an envelope", () => {
    // Given the conditions a rollup filters beacon rows with.
    // Then a request to the beacon's path with no version parameter is left
    // out. A crawler that found the URL in a page's source sends one of
    // those, and counting it would report an event nobody caused.
    assertArrayIncludes(aBeaconEvent, "cs_uri_query <> '-'");
    assertStringIncludes(
      aBeaconEvent.join(" "),
      `'${beaconParameters.version}'`,
    );
  });

  it("names the path where the envelope's own conditions leave it out", () => {
    // Given the condition status-codes takes the beacon's requests back out
    // with.
    // Then it names the path, where `aBeaconEvent` leaves the path to the
    // request's own `paths`. The two run in opposite directions. It reads
    // the column as delivered, since the path carries nothing a browser or
    // CloudFront escapes.
    assertStringIncludes(outsideTheBeaconPath, `'${defaultBeaconPath}'`);
    assertStringNotIncludes(outsideTheBeaconPath, "url_decode");
  });
});
