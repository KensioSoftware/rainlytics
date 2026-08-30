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

/** One of those two. */
type SilentMethod = (typeof silentMethods)[number];

/**
 * Wraps one `History` method so that it calls `notify` after moving.
 *
 * Returns what puts it back, which is the half with the judgement in it. See
 * {@link watchRoutes} for why that is a condition rather than an assignment.
 */
function wrapHistory(method: SilentMethod, notify: () => void): StopWatching {
  const original = history[method];

  const patched = function patched(
    this: History,
    ...args: Parameters<History[SilentMethod]>
  ): void {
    original.apply(this, args);
    notify();
  };

  history[method] = patched;

  return () => {
    if (history[method] === patched) {
      history[method] = original;
    }
  };
}

/**
 * Calls `onChange` whenever the address bar moves without a request.
 *
 * The wrapper calls through first and reports after, so `location` already
 * holds the new path by the time `onChange` reads it.
 *
 * Wrapping `History` is shared ground. A router, another analytics script or
 * a devtools extension may have wrapped it first, and may wrap it again after.
 * Each wrapper calls the one it found, so a chain of them all run.
 *
 * Stopping therefore puts the original back only where this wrapper is still
 * the outermost one. Somebody who wrapped afterwards is holding a reference
 * to this one, and overwriting `history[method]` under them would drop their
 * wrapper off the page along with this one. Where that has happened the
 * wrapper stays where it is and stops calling back, which leaves the chain
 * whole and this watch silent.
 */
export function watchRoutes(onChange: () => void): StopWatching {
  let watching = true;

  const notify = (): void => {
    if (watching) {
      onChange();
    }
  };

  const undo = silentMethods.map((method) => wrapHistory(method, notify));

  addEventListener("popstate", onChange);

  return () => {
    watching = false;

    for (const put of undo) {
      put();
    }

    removeEventListener("popstate", onChange);
  };
}
