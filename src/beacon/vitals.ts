// Core Web Vitals, measured in the browser and reported as beacon events.
//
// An access log records what arrived and what was answered. It cannot record
// how long a page took to settle or how much it moved while settling, and
// these are the measurements layer 2 exists to add.
//
// Behind its own import, because a site paying for route changes should not
// pay for this as well. `scripts/js/beacon-size.mjs` holds each entry point
// to a budget of its own.
//
// `vital-entries.ts` next door has the observers and what each measurement
// accumulates. This module says which are reported and when.
//
// **INP is not here.** It is a Core Web Vital and this is a deliberate gap.
// Computing it means grouping event-timing entries by `interactionId` and
// taking a high percentile of what that produces, and a version of that with
// a subtle mistake in it reports a plausible number rather than an obvious
// failure. A site that wants INP runs the `web-vitals` library itself and
// hands the result to `report`, which the envelope's `value` parameter is
// what makes possible. KensioSoftware/rainlytics#112 has the measurement
// behind that. `web-vitals` covering LCP, CLS and INP bundles to 3209 bytes
// gzipped, against 550 for the four below.

import type { BeaconEvent } from "../beacon-events.js";
import { vitalEventNames } from "../vital-events.js";

import type { Beacon } from "./start.js";
import {
  largestPaint,
  layoutShift,
  observe,
  type StopWatching,
} from "./vital-entries.js";

/** Stops reporting vitals and disconnects what was watching for them. */
export type StopVitals = StopWatching;

export { vitalEventNames } from "../vital-events.js";

/**
 * Rounds a measurement to something worth sending.
 *
 * Milliseconds go to whole numbers and CLS to three places. A vital carries
 * no meaning past that, and the digits would be paid for in every query
 * string and stored for as long as the log objects last.
 */
const rounded = (value: number, places = 0): number =>
  Number(value.toFixed(places));

/**
 * How long TTFB waits for the paint it would rather travel with.
 *
 * TTFB is known before anything has painted and FCP arrives later, so holding
 * the first for the second puts both in one request. #178 has what that saves
 * a site on a CloudFront flat-rate plan.
 *
 * The wait has to end somewhere. Roughly a quarter of the pages that reported
 * TTFB in the hour #177 measured never reported FCP at all, and most of those
 * were crawlers. Holding TTFB for a paint that never comes would drop those
 * measurements and bias what is left towards pages that paint, which are the
 * faster ones.
 *
 * Four seconds. Long enough for a slow page to paint first and still pair,
 * since a page painting past this is already far outside what Core Web Vitals
 * calls good, and short enough that a page nobody stays on reports anyway.
 */
export const firstByteWait = 4000;

/**
 * Reports this page's Core Web Vitals through a running beacon.
 *
 * ```typescript
 * import { startBeacon } from "@kensio/rainlytics/beacon";
 * import { reportVitals } from "@kensio/rainlytics/beacon/vitals";
 *
 * const beacon = startBeacon();
 * reportVitals(beacon);
 * ```
 *
 * Each vital is reported once, against the page that was showing when this
 * ran. LCP and CLS are only final once the page is going away, so both are
 * held until the document is hidden and sent then. That is the moment
 * `keepalive` on the send exists for, and #111 has why the beacon uses
 * `fetch` for it.
 *
 * **A page view usually costs two requests.** TTFB is known before anything
 * paints, so it waits and travels with FCP. LCP and CLS become final at the
 * same instant and travel together when the document hides. #177 and #178
 * have what a request costs a site on a CloudFront flat-rate plan.
 *
 * TTFB stops waiting after {@link firstByteWait}, or sooner where the page is
 * hidden first, in which case it goes with LCP and CLS. A quarter of the
 * pages that report TTFB never paint at all, so a wait with no end would drop
 * those and leave a measurement biased towards pages that paint.
 *
 * A page painting after that wait costs three. TTFB has gone on its own by
 * then and FCP has nothing left to travel with, so it goes on its own too.
 * Holding FCP for the hide instead would lose it on every page the browser
 * never hides, which is the trade #177 already refused.
 *
 * A page that is never hidden reports neither LCP nor CLS. Every ordinary
 * way of leaving a page hides the document first, including following a link
 * and closing the tab. Batching all four into the hide would lose TTFB and
 * FCP for every page that is never hidden, and #177 measured crawlers as
 * most of those.
 */
export function reportVitals(beacon: Beacon): StopVitals {
  const page = location.pathname;
  const measured = (event: string, value: number): BeaconEvent => ({
    event,
    page,
    value,
  });

  // Read before anything is observed, so a buffered paint entry arriving at
  // once still finds TTFB here to travel with.
  const navigation = performance.getEntriesByType("navigation").at(0) as
    | PerformanceNavigationTiming
    | undefined;

  let held: BeaconEvent | undefined =
    navigation &&
    measured(
      vitalEventNames.timeToFirstByte,
      rounded(navigation.responseStart),
    );

  /** Sends these, with TTFB along for the ride where it is still waiting. */
  const send = (...events: BeaconEvent[]): void => {
    const carried = held === undefined ? events : [held, ...events];

    held = undefined;

    if (carried.length > 0) {
      beacon.report(...carried);
    }
  };

  const waited = setTimeout(() => {
    send();
  }, firstByteWait);

  const paint = largestPaint();
  const shift = layoutShift();

  const stopping: StopVitals[] = [
    paint.stop,
    shift.stop,
    observe("paint", (entries) => {
      for (const entry of entries) {
        if (entry.name === "first-contentful-paint") {
          clearTimeout(waited);
          send(
            measured(
              vitalEventNames.firstContentfulPaint,
              rounded(entry.startTime),
            ),
          );
        }
      }
    }),
  ];

  let settled = false;

  const settle = (): void => {
    if (settled || document.visibilityState !== "hidden") {
      return;
    }

    settled = true;
    clearTimeout(waited);

    const final: BeaconEvent[] = [];
    const largest = paint.reached();

    if (largest > 0) {
      final.push(
        measured(vitalEventNames.largestContentfulPaint, rounded(largest)),
      );
    }

    const shifted = rounded(shift.reached(), 3);

    final.push(measured(vitalEventNames.cumulativeLayoutShift, shifted));

    // `send` adds TTFB where a page was hidden before it went out, which is
    // what keeps the measurement on a page nobody waited around on.
    send(...final);
  };

  document.addEventListener("visibilitychange", settle);

  return () => {
    settled = true;
    clearTimeout(waited);
    document.removeEventListener("visibilitychange", settle);

    for (const stop of stopping) {
      stop();
    }
  };
}
