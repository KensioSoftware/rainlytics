// The event names shared by the browser that reports Web Vitals and the
// rollup that reads them back.

/** The names Rainlytics reports its Web Vitals under. */
export const vitalEventNames = {
  /** Largest Contentful Paint, in milliseconds. */
  largestContentfulPaint: "lcp",

  /** Cumulative Layout Shift, as its unitless score. */
  cumulativeLayoutShift: "cls",

  /** First Contentful Paint, in milliseconds. */
  firstContentfulPaint: "fcp",

  /** Time To First Byte, in milliseconds. */
  timeToFirstByte: "ttfb",
} as const;
