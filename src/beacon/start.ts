// Starting the browser half, and what a site gets back when it does.
//
// The site imports this into its own bundle and calls it. There is no script
// tag, no second host and no extra connection, which is the first thing this
// project exists to protect. `docs/beacon/` has what a page pays for it.

import type { BeaconEvent } from "../beacon-events.js";
import { defaultBeaconPath } from "../beacon-events.js";
import { watchRoutes } from "./routes.js";
import { sendBeaconEvent } from "./send.js";

/**
 * The event name a route change is reported under.
 *
 * `beacon-events` groups by this, so a deployment reading its summaries sees
 * route changes under one name whatever else the site reports.
 */
export const routeEventName = "route";

/** What a site can change about a running beacon. */
export interface BeaconOptions {
  /**
   * The collection path, matching what `BeaconPath` was deployed with.
   *
   * Defaults to {@link defaultBeaconPath}. A site that passed `path` to the
   * construct passes the same one here, and the two disagreeing is a beacon
   * reporting into a path nothing answers.
   */
  readonly path?: string;

  /**
   * Whether route changes report themselves.
   *
   * On by default. Off leaves {@link Beacon.report} as the only way an event
   * is sent, which suits a site that would rather call its router's own hook.
   */
  readonly reportRoutes?: boolean;
}

/** A running beacon. */
export interface Beacon {
  /**
   * Reports one event.
   *
   * ```typescript
   * beacon.report({ event: "signup", page: location.pathname });
   * ```
   */
  report: (event: BeaconEvent) => void;

  /**
   * Stops reporting and puts back what starting it wrapped.
   *
   * Safe to call twice. This is what a site calls when somebody withdraws
   * consent, and `report` after it sends nothing.
   */
  stop: () => void;
}

/**
 * Starts the beacon on the current page.
 *
 * ```typescript
 * import { startBeacon } from "@kensio/rainlytics/beacon";
 *
 * const beacon = startBeacon();
 * ```
 *
 * **The page this is called on is not reported.** Loading it was a request,
 * CloudFront wrote it to the access log, and layer 1 counts it there. Sending
 * an event for it as well would count the same view twice, in two questions
 * that are supposed to agree. What the beacon reports is every route change
 * after this one.
 *
 * A route change to the path already showing is not reported either. A router
 * calling `replaceState` to put a query parameter in the address bar is the
 * ordinary case, and it is not a second view of anything.
 *
 * **Consent belongs to the site.** Nothing here reads a banner, a cookie or
 * `navigator.doNotTrack`. A site gates consent by calling this once somebody
 * has agreed and calling {@link Beacon.stop} if they take it back. A consent
 * story built in here would be one more thing every page downloads, and it
 * would be wrong for whichever banner the site actually runs.
 *
 * **There is no sampling.** A beacon event is a row in a log object the site
 * is already paying for, and `beacon-events` bounds a flood in the query
 * rather than in the browser. Sampling would cost bytes on every page to
 * save nothing worth saving, and it would put a scaling factor in front of
 * numbers that are otherwise counts.
 */
export function startBeacon(options: BeaconOptions = {}): Beacon {
  const path = options.path ?? defaultBeaconPath;

  // The page this started on, which the access log already holds. Seeding the
  // last reported page with it is what keeps the first route change from
  // reporting a view layer 1 has counted.
  let reported = location.pathname;
  let stopped = false;

  const report = (event: BeaconEvent): void => {
    if (!stopped) {
      sendBeaconEvent(path, event);
    }
  };

  const reportRoute = (): void => {
    const page = location.pathname;

    if (page !== reported) {
      reported = page;
      report({ event: routeEventName, page });
    }
  };

  const stopWatching =
    options.reportRoutes === false ? undefined : watchRoutes(reportRoute);

  return {
    report,
    stop: () => {
      stopped = true;
      stopWatching?.();
    },
  };
}
