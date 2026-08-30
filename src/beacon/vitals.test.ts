// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { collectionEndpoint } from "#test/collection-endpoint.js";
import { performanceTimeline } from "#test/performance-timeline.js";

import { startBeacon } from "./start.js";
import { reportVitals, vitalEventNames } from "./vitals.js";

describe("reporting Core Web Vitals", () => {
  /** The value one event carried, read back off the request line. */
  const valueOf = (request: string): string =>
    new URLSearchParams(request.split("?")[1]).get("n") ?? "";

  /** The event name one request carried. */
  const eventOf = (request: string): string =>
    new URLSearchParams(request.split("?")[1]).get("e") ?? "";

  /**
   * A beacon reporting vitals, and the one call that puts both away.
   *
   * Every case stops what it started. A watcher left running is re-pointed
   * at the next case's endpoint when that one takes the document URL, and it
   * then answers a `received` somebody else was waiting on.
   */
  const watching = (): { stop: () => void } => {
    const beacon = startBeacon();
    const stopVitals = reportVitals(beacon);

    return {
      stop: () => {
        stopVitals();
        beacon.stop();
      },
    };
  };

  /** What the endpoint received, as event name to value. */
  const reported = (requests: readonly string[]): Record<string, string> =>
    Object.fromEntries(
      requests.map((request) => [eventOf(request), valueOf(request)]),
    );

  it("reports the time to first byte as soon as it is known", async () => {
    // Given a page whose navigation timing is already recorded, which it is
    // by the time any bundled script runs.
    const endpoint = await collectionEndpoint();
    const timeline = performanceTimeline();
    timeline.emit("navigation", [{ responseStart: 128.4 }]);

    // When the vitals are reported.
    const { stop } = watching();

    // Then it goes out at once, rounded to a whole millisecond. Nothing
    // later can change it, so nothing is gained by holding it.
    const [request] = await endpoint.received(1);

    expect(eventOf(request ?? "")).toBe(vitalEventNames.timeToFirstByte);
    expect(valueOf(request ?? "")).toBe("128");

    stop();
    await endpoint.close();
  });

  it("reports a paint that happened before the beacon loaded", async () => {
    // Given a page that painted before the site's bundle ran, which is the
    // ordinary case on a fast connection.
    const endpoint = await collectionEndpoint();
    const timeline = performanceTimeline();
    timeline.emit("paint", [
      { name: "first-paint", startTime: 100 },
      { name: "first-contentful-paint", startTime: 210.7 },
    ]);

    // When the vitals start watching afterwards.
    const { stop } = watching();

    // Then the paint still reaches the collection path. `buffered` on the
    // observer is what asks for what already happened, and without it every
    // fast page would report nothing.
    const [request] = await endpoint.received(1);

    expect(eventOf(request ?? "")).toBe(vitalEventNames.firstContentfulPaint);
    expect(valueOf(request ?? "")).toBe("211");

    stop();
    await endpoint.close();
  });

  it("reports the largest paint once the page is going away", async () => {
    // Given a page whose largest element painted twice over, each larger
    // than the last.
    const endpoint = await collectionEndpoint();
    const timeline = performanceTimeline();
    const { stop } = watching();
    timeline.emit("largest-contentful-paint", [{ startTime: 800 }]);
    timeline.emit("largest-contentful-paint", [{ startTime: 1600.6 }]);

    // When somebody leaves.
    timeline.hide();

    // Then the last one is what is reported, and not before. LCP is not
    // final until the page stops painting, and a value sent early would be
    // whichever element happened to be largest at the time.
    const requests = await endpoint.received(2);

    expect(reported(requests)[vitalEventNames.largestContentfulPaint]).toBe(
      "1601",
    );

    stop();
    await endpoint.close();
  });

  it("scores layout shift on its worst session window", async () => {
    // Given a page that shifted twice early, then settled, then shifted once
    // more than five seconds later.
    const endpoint = await collectionEndpoint();
    const timeline = performanceTimeline();
    const { stop } = watching();
    timeline.emit("layout-shift", [
      { startTime: 100, value: 0.05 },
      { startTime: 400, value: 0.06 },
      { startTime: 9000, value: 0.08 },
    ]);

    // When the page is hidden.
    timeline.hide();

    // Then the score is the worst window rather than the sum of every shift.
    // A page that shifts a little every few seconds all day would otherwise
    // score as though it had shifted once, enormously.
    const requests = await endpoint.received(1);

    expect(reported(requests)[vitalEventNames.cumulativeLayoutShift]).toBe(
      "0.11",
    );

    stop();
    await endpoint.close();
  });

  it("leaves out a shift the reader caused", async () => {
    // Given a page that shifted because somebody tapped something, which is
    // the layout responding rather than the layout misbehaving.
    const endpoint = await collectionEndpoint();
    const timeline = performanceTimeline();
    const { stop } = watching();
    timeline.emit("layout-shift", [
      { startTime: 100, value: 0.4, hadRecentInput: true },
      { startTime: 200, value: 0.02 },
    ]);

    // When the page is hidden.
    timeline.hide();

    // Then only the shift nobody asked for is counted.
    const requests = await endpoint.received(1);

    expect(reported(requests)[vitalEventNames.cumulativeLayoutShift]).toBe(
      "0.02",
    );

    stop();
    await endpoint.close();
  });

  it("reports what a browser records where it records only some of it", async () => {
    // Given a browser with no `largest-contentful-paint` entry type, which
    // is every browser older than the metric.
    const endpoint = await collectionEndpoint();
    const timeline = performanceTimeline(["largest-contentful-paint"]);
    timeline.emit("navigation", [{ responseStart: 96 }]);

    // When the vitals are reported and the page is hidden.
    const { stop } = watching();
    timeline.hide();

    // Then the ones it does record still arrive. A browser raises over an
    // entry type it has never heard of, and one unknown type taking the
    // other three down with it would leave those pages reporting nothing.
    const requests = await endpoint.received(2);
    const seen = reported(requests);

    expect(seen[vitalEventNames.timeToFirstByte]).toBe("96");
    expect(seen[vitalEventNames.cumulativeLayoutShift]).toBe("0");
    expect(seen[vitalEventNames.largestContentfulPaint]).toBeUndefined();

    stop();
    await endpoint.close();
  });

  it("reports each vital once however often the page is hidden", async () => {
    // Given a page that has been hidden and come back, which is what
    // switching tabs does.
    const endpoint = await collectionEndpoint();
    const timeline = performanceTimeline();
    const { stop } = watching();
    timeline.emit("largest-contentful-paint", [{ startTime: 900 }]);
    timeline.hide();
    const first = await endpoint.received(2);

    // When it is hidden again.
    timeline.hide();
    await endpoint.received(2);

    // Then nothing more is sent. A vital counted twice would weight one
    // reader's page against everybody else's.
    expect(endpoint.requests).toStrictEqual(first);

    stop();
    await endpoint.close();
  });
});
