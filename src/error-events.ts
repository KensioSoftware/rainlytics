// The event names shared by the browser that reports JavaScript errors and
// the rollup that reads them back.

/** The names Rainlytics reports JavaScript errors under. */
export const errorEventNames = {
  /** A `window.onerror` error, being an exception nothing caught. */
  uncaught: "error",

  /** A promise that rejected with nothing to handle it. */
  rejection: "rejection",
} as const;

/**
 * The most of an error message that travels, in characters.
 *
 * The whole query string goes into `cs_uri_query` and is stored for as long
 * as the log objects last. A message long enough to matter is long enough to
 * read at this length, and CloudFront caps a URL well below what an
 * unbounded one could reach.
 *
 * Applied after a site's redactor. The redactor always sees the whole
 * message.
 */
export const errorMessageLimit = 200;
