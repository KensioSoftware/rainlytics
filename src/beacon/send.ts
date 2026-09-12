// How events leave the browser.
//
// A GET to a path on the site's own domain, with the payload in the query
// string. `BeaconPath` answers it with a 204 from a CloudFront Function and
// CloudFront writes the request into the access log, which is the event.
// `beacon-events.ts` holds the envelope and `docs/beacon-path/` has the round
// trip.

import {
  type BeaconEvent,
  beaconQueryString,
  beaconRequestLimit,
} from "../beacon-events.js";

/**
 * Sends events to the collection path, all of them in one request.
 *
 * A request is what a CloudFront flat-rate plan meters, so events known at
 * the same instant travel together. #177 measured a site spending 19.3% of
 * its requests on a beacon sending one event at a time.
 *
 * An empty list sends nothing. A caller with nothing to report should make no
 * request, and a row carrying no events would still be counted as traffic.
 *
 * A list too long for one URL is split across several. CloudFront refuses a
 * URL past roughly 8 KB and the refusal loses every event in it, so events
 * are gathered up to {@link beaconRequestLimit} and each group is sent. An
 * event that exceeds the limit on its own still goes, since CloudFront
 * refusing one request is visible and dropping it here would not be.
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
 */
export function sendBeaconEvents(
  path: string,
  events: readonly BeaconEvent[],
): void {
  let batch: BeaconEvent[] = [];

  for (const event of events) {
    const grown = [...batch, event];

    // One event that will not fit on its own is still sent. Dropping it
    // would lose a measurement where CloudFront refusing it can be seen.
    if (batch.length > 0 && urlFor(path, grown).length > beaconRequestLimit) {
      send(urlFor(path, batch));
      batch = [event];
    } else {
      batch = grown;
    }
  }

  if (batch.length > 0) {
    send(urlFor(path, batch));
  }
}

/** The URL one request would be sent to, events and all. */
function urlFor(path: string, events: readonly BeaconEvent[]): string {
  return `${path}?${beaconQueryString(events)}`;
}

/**
 * One request, sent and forgotten.
 *
 * The rejection is swallowed. Nothing reads the response, a failed send is
 * one row that never arrives, and an unhandled rejection in a site's console
 * over lost analytics would be worse than the loss.
 */
function send(url: string): void {
  void fetch(url, {
    keepalive: true,
    credentials: "omit",
    mode: "same-origin",
  }).catch(() => {
    // Nothing reads the response and nothing can retry usefully.
  });
}
