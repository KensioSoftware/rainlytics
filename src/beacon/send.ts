// How one event leaves the browser.
//
// A GET to a path on the site's own domain, with the payload in the query
// string. `BeaconPath` answers it with a 204 from a CloudFront Function and
// CloudFront writes the request into the access log, which is the event.
// `beacon-events.ts` holds the envelope and `docs/beacon-path/` has the round
// trip.

import { type BeaconEvent, beaconQueryString } from "../beacon-events.js";

/**
 * Sends one event to the collection path.
 *
 * `fetch` rather than `new Image()`, for the two things an image cannot do.
 *
 * `keepalive` lets a request outlive the document that started it, which is
 * what carries the last event of a visit past the navigation that ends it.
 * Chrome has had it since 66, Safari since 13 and Firefox only since 133, and
 * a browser without it ignores the option and sends the request anyway. What
 * is lost there is the unload case alone. A route change happens with the page
 * still open, and that is most of what this reports.
 *
 * `credentials: "omit"` keeps the site's cookies off every event. An image
 * beacon sends them, which is bytes on each request and a header arriving
 * somewhere a log could hold it.
 *
 * `mode: "same-origin"` fails a path that is not the site's own. The whole
 * premise is a first-party request into the site's existing CloudFront log,
 * and an absolute URL somewhere else would quietly measure nothing.
 *
 * The rejection is swallowed. Nothing reads the response, a failed send is
 * one row that never arrives, and an unhandled rejection in a site's console
 * over lost analytics would be worse than the loss.
 */
export function sendBeaconEvent(path: string, event: BeaconEvent): void {
  void fetch(`${path}?${beaconQueryString(event)}`, {
    keepalive: true,
    credentials: "omit",
    mode: "same-origin",
  }).catch(() => {
    // Nothing reads the response and nothing can retry usefully.
  });
}
