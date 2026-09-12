import {
  assertIdentical,
  assertObjectEquals,
  assertUndefined,
} from "@kensio/smartass";
// @vitest-environment happy-dom

import { describe, it } from "vitest";

import { collectionEndpoint } from "#test/collection-endpoint.js";
import { performanceTimeline } from "#test/performance-timeline.js";
import { eventsIn, theEventIn } from "#test/received-beacon-events.js";

import { startBeacon } from "./start.js";
import { reportVitals, vitalEventNames } from "./vitals.js";

describe("reporting Core Web Vitals", () => {
  /** The value one event carried, read back off the request line. */
  const valueOf = (request: string): string => theEventIn(request).value;

  /** The event name one request carried. */
  const eventOf = (request: string): string => theEventIn(request).event;

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

  /**
   * What the endpoint received, as event name to value.
   *
   * Across requests rather than one per request. LCP and CLS travel together
   * in one of them since #177, and a case about what was measured should
   * read the same either way. `requestsCarrying` is what says how many
   * requests those events arrived in.
   */
  const reported = (requests: readonly string[]): Record<string, string> =>
    Object.fromEntries(
      requests.flatMap((request) =>
        eventsIn(request).map((event) => [event.event, event.value]),
      ),
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

    assertIdentical(eventOf(request ?? ""), vitalEventNames.timeToFirstByte);
    assertIdentical(valueOf(request ?? ""), "128");

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

    assertIdentical(
      eventOf(request ?? ""),
      vitalEventNames.firstContentfulPaint,
    );
    assertIdentical(valueOf(request ?? ""), "211");

    stop();
    await endpoint.close();
  });

  it("reports all four from a bundle that ran after every one of them", async () => {
    // Given a page where the navigation, the paint, the largest paint and
    // the layout shift have all already happened. That is what a bundle
    // loaded `async defer` at the end of the body arrives to, which is where
    // a site puts the rest of its JavaScript.
    const endpoint = await collectionEndpoint();
    const timeline = performanceTimeline();
    timeline.emit("navigation", [{ responseStart: 128.4 }]);
    timeline.emit("paint", [
      { name: "first-contentful-paint", startTime: 210.7 },
    ]);
    timeline.emit("largest-contentful-paint", [{ startTime: 980.2 }]);
    timeline.emit("layout-shift", [{ startTime: 300, value: 0.05 }]);

    // When the vitals start watching afterwards, and the reader leaves.
    const { stop } = watching();
    timeline.hide();

    // Then every one of the four is reported. `buffered` on the observers
    // hands over the entries recorded before they existed, and the
    // navigation entry stays for the life of the document. So the docs can
    // say to start the beacon wherever the bundle runs, rather than asking
    // for a blocking script on every page.
    const requests = await endpoint.received(3);

    assertObjectEquals(reported(requests), {
      [vitalEventNames.timeToFirstByte]: "128",
      [vitalEventNames.firstContentfulPaint]: "211",
      [vitalEventNames.largestContentfulPaint]: "980",
      [vitalEventNames.cumulativeLayoutShift]: "0.05",
    });

    // And the two that become final together travel in one request. Four
    // measurements in three requests rather than four, which is what #177
    // asked for.
    assertObjectEquals(
      eventsIn(requests[2] ?? "").map((event) => event.event),
      [
        vitalEventNames.largestContentfulPaint,
        vitalEventNames.cumulativeLayoutShift,
      ],
    );

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
    const requests = await endpoint.received(1);

    assertIdentical(
      reported(requests)[vitalEventNames.largestContentfulPaint],
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

    assertIdentical(
      reported(requests)[vitalEventNames.cumulativeLayoutShift],
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

    assertIdentical(
      reported(requests)[vitalEventNames.cumulativeLayoutShift],
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

    assertIdentical(seen[vitalEventNames.timeToFirstByte], "96");
    assertIdentical(seen[vitalEventNames.cumulativeLayoutShift], "0");
    assertUndefined(seen[vitalEventNames.largestContentfulPaint]);

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
    const first = await endpoint.received(1);

    // When it is hidden again.
    timeline.hide();
    await endpoint.received(1);

    // Then nothing more is sent. A vital counted twice would weight one
    // reader's page against everybody else's.
    assertObjectEquals(endpoint.requests, first);

    stop();
    await endpoint.close();
  });
});
