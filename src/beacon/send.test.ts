import {
  assertIdentical,
  assertObjectEquals,
  assertStringNotIncludes,
} from "@kensio/smartass";
// @vitest-environment happy-dom

import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import {
  collectionEndpoint,
  requestsSettled,
} from "#test/collection-endpoint.js";

import { defaultBeaconPath } from "../beacon-events.js";
import { sendBeaconEvent } from "./send.js";

describe("sending one event", () => {
  it("carries a page whose characters have to be encoded", async () => {
    // Given a page whose path holds an ampersand, a space and characters
    // outside ASCII. Chinese Boost has the last of those in real paths.
    const endpoint = await collectionEndpoint();
    const page = "/文法/a b&c=d/";

    // When the event is sent.
    sendBeaconEvent(defaultBeaconPath, { event: "route", page });

    // Then what arrives decodes back to the path that went in. The value
    // travels through the browser's encoding, CloudFront's own on the way
    // into the record, and `beaconPageColumn` reading both back off.
    const [request] = await endpoint.received(1);
    const arrived = new URLSearchParams((request ?? "").split("?")[1]);

    assertIdentical(arrived.get("p"), page);
    assertStringNotIncludes(request, " ");

    await endpoint.close();
  });

  it("says nothing where the collection path cannot be reached", async () => {
    // Given a site whose collection path is not answering, which is what a
    // deployment missing `BeaconPath` looks like from the browser.
    const endpoint = await collectionEndpoint();
    await endpoint.close();

    // When an event is sent to it.
    sendBeaconEvent(defaultBeaconPath, {
      event: "route",
      page: `/${faker.lorem.slug()}/`,
    });

    // Then the failure stays inside the beacon. Vitest fails a file over an
    // unhandled rejection, so reaching the end of this case is the
    // assertion. A site's console filling with analytics that did not send
    // would be worse than the rows that did not arrive.
    //
    // The `ECONNREFUSED` on standard error is this case working. happy-dom
    // reports the refused connection whether or not anybody caught it.
    await requestsSettled();

    assertObjectEquals(endpoint.requests, []);
  });
});
