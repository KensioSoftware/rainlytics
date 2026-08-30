// The performance entries a Core Web Vital is read from.
//
// Apart from `vitals.ts` because these two answer different questions. This
// module says what the browser recorded and how a measurement accumulates
// while a page is open. That one says which of them are reported, under what
// names, and when they are sent.
//
// The split is also what keeps either file inside the complexity cap in
// fta.json, which is worth knowing before merging them back.

/** Stops watching, and disconnects whatever was observing. */
export type StopWatching = () => void;

/**
 * The longest a layout shift session window runs, in milliseconds.
 *
 * CLS is the largest of a page's session windows rather than the sum of every
 * shift. A window runs no longer than five seconds and ends after one second
 * without a shift. A page that shifts a little every few seconds all day
 * would otherwise score as though it had shifted once, enormously.
 */
const shiftWindowLimit = 5000;

/** The gap that ends a layout shift session window, in milliseconds. */
const shiftWindowGap = 1000;

/** A `layout-shift` entry, which TypeScript's DOM library has no type for. */
interface LayoutShift extends PerformanceEntry {
  readonly value: number;
  readonly hadRecentInput: boolean;
}

/** A measurement being watched, and how far it has got. */
export interface Watched {
  /** What it has reached so far, which is final once the page hides. */
  reached: () => number;

  /** Stops watching. */
  stop: StopWatching;
}

/**
 * Observes one entry type, and answers what stops observing.
 *
 * `buffered` asks for the entries recorded before this ran. A beacon started
 * from a site's own bundle is running well after the largest paint on a fast
 * page, and without it those pages would report nothing.
 *
 * A browser that does not know the entry type raises rather than reporting
 * nothing, so the failure is contained here. Every vital is optional in
 * exactly this way, and a page reports whichever ones its browser records.
 */
export function observe(
  type: string,
  seen: (entries: PerformanceEntryList) => void,
): StopWatching {
  try {
    const observer = new PerformanceObserver((list) => {
      seen(list.getEntries());
    });

    observer.observe({ type, buffered: true });

    return () => {
      observer.disconnect();
    };
  } catch {
    return () => {
      // Nothing was observed, so there is nothing to disconnect.
    };
  }
}

/**
 * Watches the largest contentful paint.
 *
 * The last entry wins. The browser reports a new one every time something
 * larger paints and stops once the reader first interacts, so whatever
 * arrived last is the largest thing they waited for.
 */
export function largestPaint(): Watched {
  let largest = 0;

  const stop = observe("largest-contentful-paint", (entries) => {
    const last = entries.at(-1);

    if (last !== undefined) {
      largest = last.startTime;
    }
  });

  return { reached: () => largest, stop };
}

/**
 * Watches how much the layout moved, scored on its worst session window.
 *
 * A window starts at the first shift, ends after a second without one, and
 * runs no longer than five. The score is the largest window and not the sum
 * of every shift.
 *
 * A shift the reader caused is left out. That is the layout responding to
 * them rather than the layout misbehaving, and the browser marks it.
 */
export function layoutShift(): Watched {
  let current = 0;
  let started = 0;
  let last = 0;
  let worst = 0;

  const stop = observe("layout-shift", (entries) => {
    for (const entry of entries as LayoutShift[]) {
      if (entry.hadRecentInput) {
        continue;
      }

      const startsWindow =
        current === 0 ||
        entry.startTime - last > shiftWindowGap ||
        entry.startTime - started > shiftWindowLimit;

      if (startsWindow) {
        current = entry.value;
        started = entry.startTime;
      } else {
        current += entry.value;
      }

      last = entry.startTime;
      worst = Math.max(worst, current);
    }
  });

  return { reached: () => worst, stop };
}
