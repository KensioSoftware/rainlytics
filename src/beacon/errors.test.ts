import {
  assertIdentical,
  assertObjectEquals,
  assertStringIncludes,
  assertStringLength,
  assertStringNotIncludes,
} from "@kensio/smartass";
// @vitest-environment happy-dom

import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import {
  collectionEndpoint,
  requestsSettled,
} from "#test/collection-endpoint.js";

import { errorEventNames, errorMessageLimit, reportErrors } from "./errors.js";
import type { ErrorOptions } from "./errors.js";
import { startBeacon } from "./start.js";

describe("reporting uncaught errors", () => {
  /**
   * A beacon reporting errors, and the one call that puts both away.
   *
   * Every case stops what it started. A listener left running is re-pointed
   * at the next case's endpoint when that one takes the document URL.
   */
  const watching = (options: ErrorOptions = {}): { stop: () => void } => {
    const beacon = startBeacon();
    const stopErrors = reportErrors(beacon, options);

    return {
      stop: () => {
        stopErrors();
        beacon.stop();
      },
    };
  };

  /** The message one event carried, read back off the request line. */
  const messageOf = (request: string): string =>
    new URLSearchParams(request.split("?")[1]).get("m") ?? "";

  /** The event name one request carried. */
  const eventOf = (request: string): string =>
    new URLSearchParams(request.split("?")[1]).get("e") ?? "";

  it("reports what an uncaught error said", async () => {
    // Given a page whose script is about to throw.
    const endpoint = await collectionEndpoint();
    const { stop } = watching();

    // When nothing catches it.
    dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("liju is not a function"),
      }),
    );

    // Then the name and the message reach the collection path. An access log
    // records a 200 for the page this happened on, and nothing in layer 1
    // can tell it from a page that worked.
    const [request] = await endpoint.received(1);

    assertIdentical(eventOf(request ?? ""), errorEventNames.uncaught);
    assertIdentical(
      messageOf(request ?? ""),
      "TypeError: liju is not a function",
    );

    stop();
    await endpoint.close();
  });

  it("reports a promise nobody handled", async () => {
    // Given a rejected promise with no catch on it.
    //
    // The event is built rather than provoked. happy-dom has no
    // `PromiseRejectionEvent` and does not raise one for a rejection it sees,
    // so the browser's half is supplied here and the beacon's half is what
    // the case is about.
    const endpoint = await collectionEndpoint();
    const { stop } = watching();
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", {
      value: new RangeError("page 400 of 12"),
    });

    // When the browser gives up on it.
    dispatchEvent(rejection);

    // Then it is reported under a name of its own, carrying what it rejected
    // with. A rejection and a throw fail differently, and a reader chasing
    // one is not chasing the other.
    const [request] = await endpoint.received(1);

    assertIdentical(eventOf(request ?? ""), errorEventNames.rejection);
    assertIdentical(messageOf(request ?? ""), "RangeError: page 400 of 12");

    stop();
    await endpoint.close();
  });

  it("reports something thrown that was never an error", async () => {
    // Given code that threw a string, which nothing stops JavaScript doing.
    const endpoint = await collectionEndpoint();
    const { stop } = watching();

    // When it goes uncaught, so the event carries a message and no error.
    dispatchEvent(new ErrorEvent("error", { message: "liju went wrong" }));

    // Then what it said is still reported. A page that throws a string
    // reports nothing worth reading if this only handles an `Error`.
    const [request] = await endpoint.received(1);

    assertIdentical(messageOf(request ?? ""), "liju went wrong");

    stop();
    await endpoint.close();
  });

  it("sends no stack", async () => {
    // Given an error carrying a stack, which every thrown `Error` does.
    const endpoint = await collectionEndpoint();
    const { stop } = watching();
    const thrown = new Error("something went wrong");

    // When it goes uncaught.
    dispatchEvent(new ErrorEvent("error", { error: thrown }));

    // Then the frames stay in the browser. A stack names the URL of every
    // file in it, none of it fits in a query string worth storing, and the
    // name and message are what a rollup would group by anyway.
    const [request] = await endpoint.received(1);

    assertStringIncludes(thrown.stack ?? "", "errors.test.ts");
    assertStringNotIncludes(request, "errors.test.ts");

    stop();
    await endpoint.close();
  });

  it("cuts a message that would fill the query string", async () => {
    // Given an error whose message runs to thousands of characters, which a
    // failed parse of a large document produces.
    const endpoint = await collectionEndpoint();
    const { stop } = watching();
    const long = "x".repeat(5000);

    // When it goes uncaught.
    dispatchEvent(new ErrorEvent("error", { error: new Error(long) }));

    // Then what travels is bounded. The whole query string is stored for as
    // long as the log objects are, and CloudFront caps a URL well below what
    // an unbounded message would reach.
    const [request] = await endpoint.received(1);

    assertStringLength(messageOf(request ?? ""), errorMessageLimit);

    stop();
    await endpoint.close();
  });

  it("redacts the whole message before cutting it short", async () => {
    // Given an address that starts before the limit and ends after it, and a
    // redactor that matches a whole address the way one would be written.
    const endpoint = await collectionEndpoint();
    const { stop } = watching({
      redact: (message) => message.replaceAll(/\S+@\S+\.\w+/gu, "[email]"),
    });
    const padding = "x".repeat(182);

    // When such an error goes uncaught.
    dispatchEvent(
      new ErrorEvent("error", {
        error: new Error(`${padding} liju@example.com`),
      }),
    );

    // Then no part of it is sent. Cutting first hands the redactor an
    // address with its domain missing, which its pattern does not match, and
    // the half that survives goes to the log.
    const [request] = await endpoint.received(1);

    assertStringNotIncludes(messageOf(request ?? ""), "liju@");
    assertStringIncludes(messageOf(request ?? ""), "[email]");

    stop();
    await endpoint.close();
  });

  it("takes the message a site would rather send", async () => {
    // Given a deployment that holds no personal data, whose own code puts an
    // address in a message.
    const endpoint = await collectionEndpoint();
    const { stop } = watching({
      redact: (message) => message.replaceAll(/\S+@\S+/gu, "[email]"),
    });

    // When such an error goes uncaught.
    dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("no account for liju@example.com"),
      }),
    );

    // Then what reaches the log is what the site chose to send. This is the
    // way back for a site that turned the viewer address off and would
    // otherwise let its own error text undo that.
    const [request] = await endpoint.received(1);

    assertIdentical(messageOf(request ?? ""), "Error: no account for [email]");

    stop();
    await endpoint.close();
  });

  it("sends nothing for an error the site drops", async () => {
    // Given a site that reports nothing it has not recognised.
    const endpoint = await collectionEndpoint();
    const { stop } = watching({ redact: () => undefined });

    // When an error goes uncaught.
    dispatchEvent(new ErrorEvent("error", { error: new Error("dropped") }));

    // Then nothing is sent at all. The drain comes first, so a send already
    // on the wire would be in the list rather than arriving after it is read.
    await requestsSettled();
    const marked = `/marked-${faker.string.uuid()}`;
    await fetch(marked);

    assertObjectEquals(endpoint.requests, [marked]);

    stop();
    await endpoint.close();
  });
});
