// @vitest-environment happy-dom

import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import {
  collectionEndpoint,
  requestsSettled,
} from "#test/collection-endpoint.js";

import { defaultBeaconPath } from "../beacon-events.js";
import { routeEventName, startBeacon } from "./start.js";

describe("the beacon a site starts", () => {
  /**
   * A request the test sends itself, to mark a point in the arrival order.
   *
   * The beacon sends and forgets, so "nothing was sent" cannot be read off
   * the endpoint the moment after acting. A request the test makes and waits
   * for gives the endpoint something to have received, and what the beacon
   * did or did not send is then visible beside it.
   *
   * The drain comes first. Waiting for this request alone would prove only
   * that this request arrived, and a beacon send already on the wire could
   * still land after the assertion read the list.
   */
  const mark = async (): Promise<string> => {
    await requestsSettled();

    const path = `/marked-${faker.string.uuid()}`;
    await fetch(path);

    return path;
  };

  /** The page a route change moves to, under a name no other case uses. */
  const aPage = (): string => `/${faker.lorem.slug()}/`;

  it("reports a route change the access log cannot see", async () => {
    // Given a beacon running on a site whose router uses the History API.
    const endpoint = await collectionEndpoint();
    const beacon = startBeacon();
    const page = aPage();

    // When the router moves to another page without making a request.
    history.pushState({}, "", page);

    // Then the collection path hears about it. No request was made for that
    // page, so CloudFront wrote no record and layer 1 counts nothing. This
    // is the gap the browser half exists to fill.
    const [request] = await endpoint.received(1);

    expect(request).toBe(
      `${defaultBeaconPath}?v=1&e=${routeEventName}&p=${encodeURIComponent(page)}`,
    );

    beacon.stop();
    await endpoint.close();
  });

  it("leaves the page it started on to the access log", async () => {
    // Given a beacon started on a page somebody has just loaded.
    const endpoint = await collectionEndpoint();
    const beacon = startBeacon();

    // When the site raises an event of its own.
    beacon.report({ event: "signup", page: location.pathname });
    const marked = await mark();

    // Then that event is the first thing the collection path hears. Loading
    // the page was a request, CloudFront recorded it, and reporting it here
    // as well would count one view twice in two questions meant to agree.
    expect(endpoint.requests[0]).toContain("e=signup");
    expect(endpoint.requests).toStrictEqual([
      endpoint.requests[0] ?? "",
      marked,
    ]);

    beacon.stop();
    await endpoint.close();
  });

  it("says nothing where the address bar moves to the page already showing", async () => {
    // Given a beacon on a page whose router puts a filter in the query
    // string, which is the ordinary use for `replaceState`.
    const endpoint = await collectionEndpoint();
    const beacon = startBeacon();

    // When the address bar moves without the page changing.
    history.replaceState({}, "", `${location.pathname}?sort=newest`);
    const marked = await mark();

    // Then nothing was reported. A query parameter is not a second view of
    // anything, and counting it as one would inflate every filtered page.
    expect(endpoint.requests).toStrictEqual([marked]);

    beacon.stop();
    await endpoint.close();
  });

  it("reports an event the site raises itself", async () => {
    // Given a site that wants to count something its own code knows about.
    const endpoint = await collectionEndpoint();
    const beacon = startBeacon();
    const page = aPage();

    // When it reports one.
    beacon.report({ event: "signup", page });

    // Then it travels in the same envelope a route change does, and lands as
    // another row in the same log.
    const [request] = await endpoint.received(1);

    expect(request).toBe(
      `${defaultBeaconPath}?v=1&e=signup&p=${encodeURIComponent(page)}`,
    );

    beacon.stop();
    await endpoint.close();
  });

  it("sends to the path the deployment was given", async () => {
    // Given a site whose router already answers `/_rainlytics`, so
    // `BeaconPath` was deployed on a path of its own.
    const endpoint = await collectionEndpoint();
    const path = `/_collect-${faker.string.uuid()}`;
    const beacon = startBeacon({ path });

    // When an event is reported.
    beacon.report({ event: "signup", page: "/" });

    // Then it goes to that path. The construct and the browser disagreeing
    // is a beacon reporting into a path nothing answers, and the first sign
    // of it is a dataset with no beacon rows in it.
    const [request] = await endpoint.received(1);

    expect(request).toBe(`${path}?v=1&e=signup&p=%2F`);

    beacon.stop();
    await endpoint.close();
  });

  it("stops reporting when somebody withdraws consent", async () => {
    // Given a beacon that has reported once.
    const endpoint = await collectionEndpoint();
    const beacon = startBeacon();
    beacon.report({ event: "signup", page: "/" });
    await endpoint.received(1);

    // When the site stops it and carries on asking it to report.
    beacon.stop();
    beacon.report({ event: "withdrawn", page: "/" });
    history.pushState({}, "", aPage());
    const marked = await mark();

    // Then neither reached the collection path. This is what a site calls
    // when a consent banner is answered the other way.
    expect(endpoint.requests.at(-1)).toBe(marked);
    expect(endpoint.requests.join(" ")).not.toContain("withdrawn");
    expect(endpoint.requests.join(" ")).not.toContain(routeEventName);

    await endpoint.close();
  });

  it("leaves route changes alone where the site would rather report them", async () => {
    // Given a site calling its own router's hook, so it asked the beacon not
    // to watch.
    const endpoint = await collectionEndpoint();
    const beacon = startBeacon({ reportRoutes: false });

    // When the router moves.
    history.pushState({}, "", aPage());
    const marked = await mark();

    // Then nothing was reported, and `report` is still the way an event is
    // sent.
    expect(endpoint.requests).toStrictEqual([marked]);

    beacon.stop();
    await endpoint.close();
  });
});
