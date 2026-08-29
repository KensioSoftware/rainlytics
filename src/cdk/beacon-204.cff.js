// The CloudFront Function that answers the beacon's collection path.
//
// It runs at viewer-request, which CloudFront reaches before the cache and
// before any origin lookup, and returns a 204 to every request the beacon
// behaviour matches. CloudFront writes an access log record for the request
// either way, and the query string the beacon put in the URL is what that
// record carries. KensioSoftware/rainlytics#99 took the decision and holds
// the reasoning.
//
// This is CloudFront Functions JS 2.0. The runtime has no modules, no
// classes, no generators, no destructuring, no spread and no `for...of`. The
// oxlint plugin @kensio/yulin ships enforces that on any `.cff.js` file. This
// one is deployed verbatim and declares no export for a test to import.

function handler() {
  return {
    statusCode: 204,
    statusDescription: "No Content",
    headers: {
      // The same event on the same page produces the same URL twice. A
      // browser holding a cached 204 would answer the second one out of its
      // own cache, and that event would reach no log.
      "cache-control": { value: "no-store" },
    },
  };
}
