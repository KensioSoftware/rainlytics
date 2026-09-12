import {
  assertArrayLength,
  assertGreaterThan,
  assertIdentical,
  assertLessThanOrEqual,
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

import { eventsIn, theEventIn } from "#test/received-beacon-events.js";

import { beaconRequestLimit, defaultBeaconPath } from "../beacon-events.js";
import { sendBeaconEvents } from "./send.js";

describe("sending one event", () => {
  it("carries a page whose characters have to be encoded", async () => {
    // Given a page whose path holds an ampersand, a space and characters
    // outside ASCII. Chinese Boost has the last of those in real paths.
    const endpoint = await collectionEndpoint();
    const page = "/文法/a b&c=d/";

    // When the event is sent.
    sendBeaconEvents(defaultBeaconPath, [{ event: "route", page }]);

    // Then what arrives decodes back to the path that went in. The value
    // travels through the browser's encoding, CloudFront's own on the way
    // into the record, and `beaconPageColumn` reading both back off.
    const [request] = await endpoint.received(1);

    assertIdentical(theEventIn(request ?? "").page, page);
    assertStringNotIncludes(request, " ");

    await endpoint.close();
  });

  it("says nothing where the collection path cannot be reached", async () => {
    // Given a site whose collection path is not answering, which is what a
    // deployment missing `BeaconPath` looks like from the browser.
    const endpoint = await collectionEndpoint();
    await endpoint.close();

    // When an event is sent to it.
    sendBeaconEvents(defaultBeaconPath, [
      {
        event: "route",
        page: `/${faker.lorem.slug()}/`,
      },
    ]);

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

  it("splits events too many for one URL across several requests", async () => {
    // Given far more events than one URL can hold. CloudFront refuses a URL
    // past roughly 8 KB, and a refused request loses every event in it.
    const endpoint = await collectionEndpoint();
    const events = Array.from({ length: 200 }, (_, index) => ({
      event: "route",
      page: `/${faker.lorem.slug()}/${String(index)}/`,
    }));

    // When they are all reported at once.
    sendBeaconEvents(defaultBeaconPath, events);
    await requestsSettled();

    // Then every one of them still arrives, across as many requests as it
    // took, and no request is over the limit.
    const arrived = endpoint.requests.flatMap((request) => eventsIn(request));

    assertArrayLength(arrived, events.length);
    assertObjectEquals(
      arrived.map((event) => event.page),
      events.map((event) => event.page),
    );
    assertGreaterThan(endpoint.requests.length, 1);

    for (const request of endpoint.requests) {
      assertLessThanOrEqual(request.length, beaconRequestLimit);
    }

    await endpoint.close();
  });

  it("sends one event that is too large on its own anyway", async () => {
    // Given a single event whose own payload exceeds what a URL may carry.
    // Splitting cannot help, since there is nothing to split.
    const endpoint = await collectionEndpoint();
    const message = "x".repeat(beaconRequestLimit);

    // When it is reported.
    sendBeaconEvents(defaultBeaconPath, [
      { event: "error", page: "/", message },
    ]);
    await requestsSettled();

    // Then it is sent rather than dropped. CloudFront refusing one request
    // is something a site can see, and a measurement quietly discarded here
    // is not. `errorMessageLimit` is what keeps a real message under this.
    assertArrayLength(endpoint.requests, 1);

    await endpoint.close();
  });
});
