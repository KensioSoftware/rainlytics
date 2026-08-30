// Telling the beacon that a single-page app has changed route.
//
// A route change moves the address bar and makes no request, so CloudFront
// has no record of it and layer 1 cannot see it. This is the gap the browser
// half exists to fill.
//
// The three ways a route changes under the History API are `pushState`,
// `replaceState` and the back button. Neither of the first two fires an event
// of its own, so both are wrapped. `popstate` covers the third.

/** Undoes what {@link watchRoutes} put in place. */
export type StopWatching = () => void;

/** The two `History` methods that move the address bar without an event. */
const silentMethods = ["pushState", "replaceState"] as const;

/**
 * Calls `onChange` whenever the address bar moves without a request.
 *
 * The wrapper calls through first and reports after, so `location` already
 * holds the new path by the time `onChange` reads it.
 *
 * Wrapping `History` is shared ground. A router, another analytics script or
 * a devtools extension may have wrapped it first, and may wrap it again after.
 * Each wrapper calls the one it found, so a chain of them all run. The
 * returned function puts back what this one found, which is correct as long
 * as it runs in the reverse order of the wrapping. That is the same contract
 * every other wrapper on the page is working to.
 */
export function watchRoutes(onChange: () => void): StopWatching {
  const undo: StopWatching[] = [];

  for (const method of silentMethods) {
    const original = history[method];

    history[method] = function patched(
      this: History,
      ...args: Parameters<History[typeof method]>
    ): void {
      original.apply(this, args);
      onChange();
    };

    undo.push(() => {
      history[method] = original;
    });
  }

  addEventListener("popstate", onChange);

  return () => {
    for (const put of undo) {
      put();
    }
    removeEventListener("popstate", onChange);
  };
}
