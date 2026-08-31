// Uncaught JavaScript errors, reported as beacon events.
//
// An access log records a 200 for a page whose script threw on the way to
// rendering it. Nothing in layer 1 can tell that page from one that worked.
//
// Behind its own import, and that is a privacy decision as much as a page
// weight one. Every other thing the beacon sends is either a path the site
// publishes or a number. An error message is the site's own text, and
// `docs/beacon/` has what a deployment holding no personal data has to know
// before importing this.

import { errorEventNames, errorMessageLimit } from "../error-events.js";

import type { Beacon } from "./start.js";

/** Stops reporting errors and removes what was listening for them. */
export type StopErrors = () => void;

export { errorEventNames, errorMessageLimit } from "../error-events.js";

/** What a site can change about error reporting. */
export interface ErrorOptions {
  /**
   * Rewrites a message before it is sent, or drops the event.
   *
   * Answering `undefined` reports nothing for that error. This is where a
   * deployment that holds no personal data takes out whatever its own code
   * puts in a message.
   *
   * ```typescript
   * reportErrors(beacon, {
   *   redact: (message) => message.replace(/\S+@\S+/gu, "[email]"),
   * });
   * ```
   */
  readonly redact?: (message: string) => string | undefined;
}

/**
 * What one thrown thing says, as a single line.
 *
 * The name and the message, and no stack. A stack carries the URLs of every
 * frame and often a good deal more, and none of it fits in a query string
 * worth storing. What is here is enough to count one error apart from
 * another, which is what a rollup over these rows would group by.
 */
function said(thrown: unknown): string {
  if (thrown instanceof Error) {
    return `${thrown.name}: ${thrown.message}`;
  }

  return String(thrown);
}

/**
 * Reports uncaught errors and unhandled rejections through a running beacon.
 *
 * ```typescript
 * import { startBeacon } from "@kensio/rainlytics/beacon";
 * import { reportErrors } from "@kensio/rainlytics/beacon/errors";
 *
 * const beacon = startBeacon();
 * reportErrors(beacon);
 * ```
 *
 * The page is read when the error happens rather than when this ran, so an
 * error in a single-page app is reported against the route it happened on.
 *
 * Nothing here handles the error. Both listeners are passive, the browser
 * still logs to the console, and any other handler on the page still runs.
 */
export function reportErrors(
  beacon: Beacon,
  options: ErrorOptions = {},
): StopErrors {
  const redact = options.redact ?? ((message: string): string => message);

  const report = (event: string, thrown: unknown): void => {
    // Redacted whole, then cut. Cutting first would hand the redactor a
    // value with its end missing, and a pattern written for the whole of one
    // then matches nothing while the half that survives goes to the log.
    const message = redact(said(thrown));

    if (message !== undefined) {
      beacon.report({
        event,
        page: location.pathname,
        message: message.slice(0, errorMessageLimit),
      });
    }
  };

  const onError = (event: ErrorEvent): void => {
    report(errorEventNames.uncaught, event.error ?? event.message);
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    report(errorEventNames.rejection, event.reason);
  };

  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);

  return () => {
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };
}
