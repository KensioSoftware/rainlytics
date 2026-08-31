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
 * TTFB and FCP are known as soon as they happen and go straight out.
 *
 * A page that is never hidden reports neither LCP nor CLS. Every ordinary
 * way of leaving a page hides the document first, including following a link
 * and closing the tab.
 */
export function reportVitals(beacon: Beacon): StopVitals {
  const page = location.pathname;
  const report = (event: string, value: number): void => {
    beacon.report({ event, page, value });
  };

  const paint = largestPaint();
  const shift = layoutShift();

  const stopping: StopVitals[] = [
    paint.stop,
    shift.stop,
    observe("paint", (entries) => {
      for (const entry of entries) {
        if (entry.name === "first-contentful-paint") {
          report(
            vitalEventNames.firstContentfulPaint,
            rounded(entry.startTime),
          );
        }
      }
    }),
  ];

  const navigation = performance.getEntriesByType("navigation").at(0) as
    | PerformanceNavigationTiming
    | undefined;

  if (navigation !== undefined) {
    report(vitalEventNames.timeToFirstByte, rounded(navigation.responseStart));
  }

  let settled = false;

  const settle = (): void => {
    if (settled || document.visibilityState !== "hidden") {
      return;
    }

    settled = true;

    if (paint.reached() > 0) {
      report(vitalEventNames.largestContentfulPaint, rounded(paint.reached()));
    }

    report(vitalEventNames.cumulativeLayoutShift, rounded(shift.reached(), 3));
  };

  document.addEventListener("visibilitychange", settle);

  return () => {
    settled = true;
    document.removeEventListener("visibilitychange", settle);

    for (const stop of stopping) {
      stop();
    }
  };
}
