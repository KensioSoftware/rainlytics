import { describe, expect, it } from "vitest";

import { beaconParameters, defaultBeaconPath } from "./beacon-events.js";
import {
  aBeaconEvent,
  beaconEventColumn,
  outsideTheBeaconPath,
} from "./beacon-rows.js";

describe("reading a beacon event off a row", () => {
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

  it("names the path where the envelope's own conditions leave it out", () => {
    // Given the condition status-codes takes the beacon's requests back out
    // with.
    // Then it names the path, where `aBeaconEvent` leaves the path to the
    // request's own `paths`. The two run in opposite directions. It reads
    // the column as delivered, since the path carries nothing a browser or
    // CloudFront escapes.
    expect(outsideTheBeaconPath).toContain(`'${defaultBeaconPath}'`);
    expect(outsideTheBeaconPath).not.toContain("url_decode");
  });
});
