/**
 * A stand-in for the browser's performance timeline, for the vitals tests.
 *
 * happy-dom's `PerformanceObserver` is Node's, which records `mark`,
 * `measure` and `resource` and knows nothing of `largest-contentful-paint`,
 * `layout-shift`, `paint` or `navigation`. Those four are the whole subject
 * of `vitals.ts`, so a case needs somewhere to put them.
 *
 * This holds the entries a test hands it and delivers them to whatever is
 * observing that type, which is the browser's half of the arrangement. The
 * half under test is what `vitals.ts` does with them: which largest paint
 * wins, how layout shifts gather into session windows, and when each is sent.
 * That arithmetic is where a bug would be, and it is real here.
 *
 * What this cannot prove is that a real browser's entries mean what
 * `vitals.ts` reads them to mean. Nothing in process can. `docs/beacon/`
 * names the entry types so that claim is at least written down where somebody
 * can check it against the specification.
 */

import { vi } from "vitest";

/** The fields a `layout-shift` entry carries that these tests set. */
export interface ShiftEntry {
  readonly startTime: number;
  readonly value: number;
  readonly hadRecentInput?: boolean;
}

/** The browser's performance timeline, under a test's control. */
export interface PerformanceTimeline {
  /** Delivers entries to whatever is observing that type. */
  emit: (type: string, entries: readonly object[]) => void;

  /** Hides the document and fires the event that goes with it. */
  hide: () => void;
}

/**
 * Puts the timeline under a test's control for the rest of the case.
 *
 * `refuses` names entry types the browser is to reject, which is what an
 * older one does for a type it has never heard of. It raises on `observe`
 * rather than reporting nothing, the way a real browser does.
 *
 * Call it before whatever starts observing. `buffered` is honoured, so
 * entries handed over before an observer starts still reach it, which is how
 * a real page delivers a paint that happened before the beacon loaded.
 *
 * Vitest puts the globals back afterwards through `unstubGlobals`.
 */
export function performanceTimeline(
  refuses: readonly string[] = [],
): PerformanceTimeline {
  const observers = new Map<string, ((entries: object[]) => void)[]>();
  const recorded = new Map<string, object[]>();

  class TimelineObserver {
    private readonly seen: (entries: object[]) => void;

    constructor(callback: (list: { getEntries: () => object[] }) => void) {
      this.seen = (entries: object[]): void => {
        callback({ getEntries: () => entries });
      };
    }

    observe({ type, buffered }: { type: string; buffered?: boolean }): void {
      if (refuses.includes(type)) {
        throw new TypeError(`${type} is not a valid entry type`);
      }

      observers.set(type, [...(observers.get(type) ?? []), this.seen]);

      const already = recorded.get(type);

      if (buffered === true && already !== undefined && already.length > 0) {
        this.seen(already);
      }
    }

    disconnect(): void {
      for (const [type, listeners] of observers) {
        observers.set(
          type,
          listeners.filter((listener) => listener !== this.seen),
        );
      }
    }
  }

  vi.stubGlobal("PerformanceObserver", TimelineObserver);

  // Only `getEntriesByType` is answered here. The rest goes through to the
  // real one, because happy-dom builds every `Event` off `performance.now`
  // and a wholesale replacement takes `dispatchEvent` down with it.
  vi.stubGlobal(
    "performance",
    new Proxy(performance, {
      get: (target, name, receiver): unknown =>
        name === "getEntriesByType"
          ? (type: string): object[] => recorded.get(type) ?? []
          : Reflect.get(target, name, receiver),
    }),
  );

  return {
    emit: (type, entries) => {
      recorded.set(type, [...(recorded.get(type) ?? []), ...entries]);

      for (const listener of observers.get(type) ?? []) {
        listener([...entries]);
      }
    },
    hide: () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}
